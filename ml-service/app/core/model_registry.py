"""Resolves which model version is currently serving for each model type.

The registry is deliberately filesystem-backed: a deployment swaps a model by
writing a new ``active_version.json``, with no code change and no restart.

Layout::

    models/
      disease/
        active_version.json
        v3/  weights.onnx, labels.json, ...
      forecast/
        active_version.json

``active_version.json``::

    {
      "version": "v3",
      "artifact": "weights.onnx",
      "trained_at": "2026-01-14T09:12:00Z",
      "metrics": {"accuracy": 0.91}
    }
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from app.core.config import get_settings
from app.schemas.model import ActiveModel, ModelType

ACTIVE_VERSION_FILE = "active_version.json"


class ModelRegistryError(RuntimeError):
    """Raised when a model's active version cannot be resolved."""


def _manifest_path(model_type: ModelType) -> Path:
    return get_settings().models_dir / model_type.value / ACTIVE_VERSION_FILE


def load_active(model_type: ModelType) -> ActiveModel:
    """Read the active manifest for ``model_type``.

    Raises:
        ModelRegistryError: the manifest is missing, unreadable, or invalid.
    """
    path = _manifest_path(model_type)

    if not path.is_file():
        raise ModelRegistryError(f"No {ACTIVE_VERSION_FILE} for model type '{model_type.value}'")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ModelRegistryError(f"Malformed {path.name} for '{model_type.value}': {exc}") from exc

    if not isinstance(raw, dict):
        raise ModelRegistryError(f"{path.name} for '{model_type.value}' must contain an object")

    version = raw.get("version")
    if not isinstance(version, str) or not version:
        raise ModelRegistryError(f"{path.name} for '{model_type.value}' has no 'version'")

    artifact = raw.get("artifact")
    artifact_path = path.parent / version / artifact if isinstance(artifact, str) else None

    trained_at_raw = raw.get("trained_at")
    trained_at: datetime | None = None
    if isinstance(trained_at_raw, str):
        try:
            trained_at = datetime.fromisoformat(trained_at_raw.replace("Z", "+00:00"))
        except ValueError:
            # A bad timestamp should not take the model out of service.
            trained_at = None

    metrics = raw.get("metrics")

    return ActiveModel(
        model_type=model_type,
        version=version,
        artifact=artifact,
        # The manifest can point at an artifact that has not been shipped yet;
        # surfacing that is the whole point of the readiness check.
        artifact_present=artifact_path.is_file() if artifact_path is not None else False,
        trained_at=trained_at,
        metrics=metrics if isinstance(metrics, dict) else {},
    )


def list_active() -> list[ActiveModel]:
    """Active model for every type that has a readable manifest."""
    resolved: list[ActiveModel] = []
    for model_type in ModelType:
        try:
            resolved.append(load_active(model_type))
        except ModelRegistryError:
            # A model type with no manifest yet is simply not serving.
            continue
    return resolved
