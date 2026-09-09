"""Schemas for model metadata."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelType(str, Enum):
    """Model families this service serves. Values are the directory names."""

    DISEASE = "disease"
    FORECAST = "forecast"


class ActiveModel(BaseModel):
    """The version of a model currently in service."""

    model_config = ConfigDict(protected_namespaces=())

    model_type: ModelType
    version: str
    artifact: str | None = None
    artifact_present: bool = Field(
        default=False,
        description="Whether the artifact named by the manifest exists on disk.",
    )
    trained_at: datetime | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)


class ActiveModelsResponse(BaseModel):
    """Response for ``GET /models/active``."""

    count: int
    models: list[ActiveModel]
