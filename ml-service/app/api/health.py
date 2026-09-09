"""Liveness endpoint."""

from __future__ import annotations

import time

from fastapi import APIRouter

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])

_STARTED_AT = time.monotonic()

SERVICE_VERSION = "0.1.0"


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
def health() -> HealthResponse:
    """Report that the process is up. Touches no models and no disk."""
    settings: Settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=SERVICE_VERSION,
        environment=settings.environment,
        uptime_seconds=round(time.monotonic() - _STARTED_AT, 3),
    )
