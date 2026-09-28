"""Schemas for model metadata."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DiseaseModelInfo(BaseModel):
    """Response for ``GET /models/disease``: what is actually serving right now."""

    # `model_` is a protected prefix in pydantic v2.
    model_config = ConfigDict(protected_namespaces=())

    loaded: bool
    version: str | None = None
    onnx_sha256: str | None = None
    classes: list[str] = Field(default_factory=list)
    input_size: int | None = None
    temperature: float
    threshold_base: float
    threshold_healthy: float
    error: str | None = None
