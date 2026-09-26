"""HTTP behaviour of the ML service: every status code the Node API relies on."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.services.disease_model import ModelState

URL = "/v1/diagnose"


def upload(client: TestClient, data: bytes, headers: dict[str, str] | None = None):
    return client.post(
        URL, files={"image": ("leaf.jpg", data, "image/jpeg")}, headers=headers or {}
    )


# ---------- probes ----------


def test_health_is_open_and_ok(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_ready_reports_the_loaded_model(client: TestClient) -> None:
    r = client.get("/ready")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
    assert r.json()["model_version"]


# ---------- authentication ----------


def test_diagnose_without_key_is_401(client: TestClient, disease_photo: bytes) -> None:
    assert upload(client, disease_photo).status_code == 401


def test_diagnose_with_wrong_key_is_401(client: TestClient, disease_photo: bytes) -> None:
    r = upload(client, disease_photo, {"X-Internal-Key": "wrong"})
    assert r.status_code == 401


# ---------- decisions ----------


def test_disease_photo_is_diagnosed_with_heatmap(
    client: TestClient, auth: dict[str, str], disease_photo: bytes
) -> None:
    r = upload(client, disease_photo, auth)
    assert r.status_code == 200
    body = r.json()

    assert body["status"] == "diagnosed"
    assert body["class_key"] == "maize_common_rust"
    assert body["is_healthy"] is False
    assert body["confidence"] >= body["required_confidence"] == 0.7
    assert len(body["top"]) == 3

    heatmap = body["heatmap"]
    assert heatmap is not None
    grid = heatmap["grid"]
    assert len(grid) == 7 and all(len(row) == 7 for row in grid)
    values = [v for row in grid for v in row]
    assert min(values) >= 0.0 and max(values) == 1.0
    assert heatmap["region"] == [0.0625, 0.0625, 0.9375, 0.9375]


def test_healthy_photo_has_no_heatmap(
    client: TestClient, auth: dict[str, str], healthy_photo: bytes
) -> None:
    body = upload(client, healthy_photo, auth).json()
    assert body["class_key"] == "potato_healthy"
    assert body["is_healthy"] is True
    assert body["required_confidence"] == 0.9  # the asymmetric rule
    assert body["heatmap"] is None


# ---------- bad uploads ----------


def test_not_an_image_is_400(client: TestClient, auth: dict[str, str]) -> None:
    r = upload(client, b"this is not a photo", auth)
    assert r.status_code == 400
    assert "not a supported image" in r.json()["detail"]


def test_tiny_image_is_400(client: TestClient, auth: dict[str, str]) -> None:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "green").save(buf, format="PNG")
    r = upload(client, buf.getvalue(), auth)
    assert r.status_code == 400
    assert "too small" in r.json()["detail"]


def test_oversized_upload_is_413(client: TestClient, auth: dict[str, str]) -> None:
    too_big = b"0" * (get_settings().max_upload_bytes + 100_000)
    r = upload(client, too_big, auth)
    assert r.status_code == 413


def test_missing_image_field_is_422(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post(URL, headers=auth, data={"not_image": "x"})
    assert r.status_code == 422


# ---------- model not loaded ----------


def test_model_not_loaded_gives_503_everywhere(
    client: TestClient, auth: dict[str, str], disease_photo: bytes
) -> None:
    original = client.app.state.model_state
    client.app.state.model_state = ModelState(error="test: model missing")
    try:
        r = upload(client, disease_photo, auth)
        assert r.status_code == 503
        assert r.json()["detail"] == "test: model missing"
        assert client.get("/ready").status_code == 503
        assert client.get("/health").status_code == 200  # alive, just not ready
    finally:
        client.app.state.model_state = original
