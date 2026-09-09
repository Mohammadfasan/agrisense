"""Model metadata endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.model_registry import ModelRegistryError, list_active, load_active
from app.schemas.model import ActiveModel, ActiveModelsResponse, ModelType

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/active", response_model=ActiveModelsResponse, summary="Active model versions")
def active_models() -> ActiveModelsResponse:
    """List the serving version of every model type that has a manifest."""
    models = list_active()
    return ActiveModelsResponse(count=len(models), models=models)


@router.get("/active/{model_type}", response_model=ActiveModel, summary="One active model")
def active_model(model_type: ModelType) -> ActiveModel:
    """Resolve the serving version of a single model type."""
    try:
        return load_active(model_type)
    except ModelRegistryError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
