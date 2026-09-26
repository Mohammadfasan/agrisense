"""Response schema for POST /v1/diagnose.

The ML service always returns its best guess, even when escalated: the
Node API decides what the farmer sees (no diagnosis below the threshold),
while an officer can still see what the model thought.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CandidateOut(BaseModel):
    class_key: str
    probability: float


class HeatmapOut(BaseModel):
    grid: list[list[float]] = Field(description="rows x cols, 0..1; row 0 is the top of the photo")
    region: tuple[float, float, float, float] = Field(
        description="left, top, right, bottom of the photo the grid covers, as fractions"
    )


class DiagnoseResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: Literal["diagnosed", "escalated"]
    class_key: str
    is_healthy: bool
    confidence: float
    required_confidence: float
    top: list[CandidateOut]
    heatmap: HeatmapOut | None = Field(description="only when the top class is a disease")
    model_version: str
    inference_ms: float


class ErrorResponse(BaseModel):
    detail: str
