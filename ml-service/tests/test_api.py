"""Endpoint tests for the ML service."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

client = TestClient(create_app())


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "agrisense-ml"
    assert body["uptime_seconds"] >= 0


def test_active_models_lists_both_types() -> None:
    response = client.get("/models/active")
    assert response.status_code == 200

    body = response.json()
    assert body["count"] == 2

    types = {model["model_type"] for model in body["models"]}
    assert types == {"disease", "forecast"}


def test_active_model_reports_missing_artifact() -> None:
    """The placeholder manifests point at artifacts that were never shipped."""
    response = client.get("/models/active/disease")
    assert response.status_code == 200

    body = response.json()
    assert body["version"] == "v1"
    assert body["artifact"] == "weights.onnx"
    assert body["artifact_present"] is False


def test_unknown_model_type_is_rejected() -> None:
    response = client.get("/models/active/nonsense")
    assert response.status_code == 422


def test_models_dir_is_anchored_to_service_root() -> None:
    """A relative MODELS_DIR must not depend on the process working directory."""
    from app.core.config import SERVICE_ROOT, Settings

    settings = Settings(models_dir=Path("models"))
    assert settings.models_dir.is_absolute()
    assert settings.models_dir == (SERVICE_ROOT / "models").resolve()
