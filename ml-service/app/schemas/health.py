"""Schemas for the liveness and readiness probes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Response for ``GET /health``: the process is alive."""

    status: Literal["ok"]
    service: str
    version: str
    environment: str
    uptime_seconds: float


class ReadyResponse(BaseModel):
    """Response for ``GET /ready``: the service can take scan traffic."""

    # `model_` is a protected prefix in pydantic v2; allow `model_version`.
    model_config = ConfigDict(protected_namespaces=())

    status: Literal["ready", "not_ready"]
    model_version: str | None = None
    reason: str | None = None
