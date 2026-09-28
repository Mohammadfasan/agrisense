"""The rules that must never silently change: decision policy and config validation."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.inference_config import (
    INFERENCE_CONFIG_PATH,
    get_inference_config,
    load_inference_config,
)
from app.services.policy import DecisionPolicy

# index 0 = maize_common_rust (disease), index 1 = maize_healthy


@pytest.mark.parametrize(
    ("class_index", "logit", "expected_status"),
    [
        (0, 5.0, "diagnosed"),  # disease at 0.866 >= 0.70
        (1, 5.0, "escalated"),  # healthy at the SAME 0.866 < 0.90
        (1, 8.0, "diagnosed"),  # healthy at 0.988 >= 0.90
        (0, 2.0, "escalated"),  # disease at 0.333 < 0.70
    ],
)
def test_asymmetric_thresholds(class_index: int, logit: float, expected_status: str) -> None:
    policy = DecisionPolicy.from_config(get_inference_config())
    decision = policy.decide(np.eye(len(policy.class_keys))[class_index] * logit)
    assert decision.status == expected_status


def test_missing_internal_key_stops_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INTERNAL_API_KEY", raising=False)
    with pytest.raises(ValidationError, match="internal_api_key"):
        Settings(_env_file=None)


def test_placeholder_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="placeholder"):
        Settings(_env_file=None, internal_api_key="change-me-generate-a-real-key")


def test_short_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        Settings(_env_file=None, internal_api_key="short")


def test_healthy_threshold_below_base_is_rejected(tmp_path: Path) -> None:
    text = INFERENCE_CONFIG_PATH.read_text(encoding="utf-8").replace(
        "healthy: 0.90", "healthy: 0.50"
    )
    bad = tmp_path / "inference.yaml"
    bad.write_text(text, encoding="utf-8")
    with pytest.raises(ValidationError, match="healthy must be >= thresholds.base"):
        load_inference_config(bad)
