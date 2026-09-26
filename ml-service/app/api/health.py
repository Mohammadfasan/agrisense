"""Liveness and readiness endpoints."""

from __future__ import annotations

import time

from fastapi import APIRouter, Request, Response, status

from app.core.config import Settings, get_settings
from app.schemas.health import HealthResponse, ReadyResponse
from app.services.disease_model import ModelState

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


@router.get(
    "/ready",
    response_model=ReadyResponse,
    summary="Readiness probe",
    responses={503: {"model": ReadyResponse, "description": "Model not loaded"}},
)
def ready(request: Request, response: Response) -> ReadyResponse:
    """200 only when the disease model is loaded and verified; otherwise 503 + reason.

    The reason can include a file path. That is acceptable because this
    service is internal: only the Node API calls it, never a browser.
    """
    state: ModelState | None = getattr(request.app.state, "model_state", None)

    if state is None or not state.ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadyResponse(
            status="not_ready",
            reason=state.error if state else "startup has not finished",
        )

    return ReadyResponse(status="ready", model_version=state.model.version)
