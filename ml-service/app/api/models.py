"""Model metadata endpoints.

Reports the model that is actually loaded in this process (from app.state),
not what a file on disk claims. The version, hash and class list come from
the verified sidecar; the policy numbers come from the validated config.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.inference_config import get_inference_config
from app.schemas.model import DiseaseModelInfo
from app.services.disease_model import ModelState

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/disease", response_model=DiseaseModelInfo, summary="Disease model in service")
def disease_model(request: Request) -> DiseaseModelInfo:
    config = get_inference_config()
    policy = {
        "temperature": config.calibration.temperature,
        "threshold_base": config.thresholds.base,
        "threshold_healthy": config.thresholds.healthy,
    }

    state: ModelState | None = getattr(request.app.state, "model_state", None)
    if state is None or state.model is None:
        return DiseaseModelInfo(
            loaded=False,
            error=state.error if state else "startup has not finished",
            **policy,
        )

    model = state.model
    return DiseaseModelInfo(
        loaded=True,
        version=model.version,
        onnx_sha256=model.onnx_sha256,
        classes=model.class_keys,
        input_size=model.input_spec["center_crop"],
        **policy,
    )
