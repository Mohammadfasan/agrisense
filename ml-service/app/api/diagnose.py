"""POST /v1/diagnose: one leaf photo in, one decision out.

Called only by the Node API (X-Internal-Key). Status codes:
  200  decision (diagnosed or escalated)
  400  not a usable photo - `detail` is safe to show the farmer
  401  missing or wrong internal key
  411  no Content-Length          (middleware, app/core/limits.py)
  413  photo too large            (middleware, and re-checked here)
  503  model not loaded - the same reason /ready gives
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.core.config import Settings, get_settings
from app.core.security import require_internal_key
from app.schemas.diagnose import CandidateOut, DiagnoseResponse, ErrorResponse, HeatmapOut
from app.services.disease_model import ModelState, Prediction
from app.services.preprocess import InvalidImageError

router = APIRouter(prefix="/v1", tags=["diagnose"], dependencies=[Depends(require_internal_key)])


def to_response(p: Prediction) -> DiagnoseResponse:
    d = p.decision
    return DiagnoseResponse(
        status=d.status,
        class_key=d.class_key,
        is_healthy=d.is_healthy,
        confidence=round(d.confidence, 4),
        required_confidence=d.required,
        top=[
            CandidateOut(class_key=c.class_key, probability=round(c.probability, 4)) for c in d.top
        ],
        heatmap=(
            HeatmapOut(grid=[list(row) for row in p.heatmap.grid], region=p.heatmap.region)
            if p.heatmap is not None
            else None
        ),
        model_version=p.model_version,
        inference_ms=p.inference_ms,
    )


@router.post(
    "/diagnose",
    response_model=DiagnoseResponse,
    summary="Diagnose one leaf photo",
    responses={
        400: {"model": ErrorResponse, "description": "Not a usable photo"},
        401: {"model": ErrorResponse, "description": "Missing or invalid internal key"},
        413: {"model": ErrorResponse, "description": "Photo too large"},
        503: {"model": ErrorResponse, "description": "Model not loaded"},
    },
)
def diagnose(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File(description="Leaf photo: JPEG, PNG or WebP")],
) -> DiagnoseResponse:
    state: ModelState | None = getattr(request.app.state, "model_state", None)
    if state is None or state.model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=state.error if state else "startup has not finished",
        )

    # Read at most one byte past the limit: enough to know it is too big.
    data = image.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="the upload is too large",
        )

    try:
        prediction = state.model.predict(data)
    except InvalidImageError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return to_response(prediction)
