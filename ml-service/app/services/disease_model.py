"""Loads the disease model once at startup and reports whether it is ready.

Sources of truth (ADR-00Y):
  config/inference.yaml (release:)  -> which files, pinned SHA256, version
  sidecar JSON                      -> input recipe, outputs, class order
  config/classes.yaml               -> class keys the rest of the app uses

Loading never downloads (that is scripts/fetch_model.py's job). If anything
is missing or does not match, the model is NOT loaded and `error` says why.
/ready then returns 503 with that reason, while /health stays 200: the
process is alive, it just must not receive scan traffic.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import onnxruntime as ort

from app.core.classes import load_classes
from app.core.config import Settings
from app.core.inference_config import InferenceConfig

log = logging.getLogger(__name__)

EXPECTED_INPUTS = ["image"]
EXPECTED_OUTPUTS = ["logits", "cams"]


class ModelLoadError(RuntimeError):
    """The model files are missing, altered, or do not match the config."""


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass(frozen=True)
class DiseaseModel:
    """A verified, loaded model. Only created when every check has passed."""

    version: str
    onnx_sha256: str
    session: ort.InferenceSession
    sidecar: dict[str, Any]
    class_keys: list[str]

    @property
    def input_spec(self) -> dict[str, Any]:
        return self.sidecar["input"]


@dataclass(frozen=True)
class ModelState:
    """What the app knows at startup: a model, or the reason there is none."""

    model: DiseaseModel | None = None
    error: str | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None


def _load(settings: Settings, config: InferenceConfig) -> DiseaseModel:
    release = config.release
    onnx_path = settings.models_dir / release.onnx.file
    sidecar_path = settings.models_dir / release.sidecar.file

    # 1. Files exist
    for path in (onnx_path, sidecar_path):
        if not path.is_file():
            raise ModelLoadError(
                f"{path.name} not found in {settings.models_dir} - run scripts/fetch_model.py"
            )

    # 2. Files are exactly the pinned ones
    for path, expected in (
        (onnx_path, release.onnx.sha256),
        (sidecar_path, release.sidecar.sha256),
    ):
        actual = sha256_of(path)
        if actual != expected:
            raise ModelLoadError(
                f"{path.name}: SHA256 {actual[:12]}... does not match pinned {expected[:12]}..."
            )

    # 3. Sidecar agrees with the config and with classes.yaml
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    if sidecar.get("model_version") != release.version:
        raise ModelLoadError(
            f"Sidecar version {sidecar.get('model_version')} != config {release.version}"
        )
    class_keys = [c.key for c in load_classes()]
    if sidecar.get("classes") != class_keys:
        raise ModelLoadError("Sidecar class order differs from config/classes.yaml")

    # 4. The graph has the inputs/outputs the service expects
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inputs = [i.name for i in session.get_inputs()]
    outputs = [o.name for o in session.get_outputs()]
    if inputs != EXPECTED_INPUTS or outputs != EXPECTED_OUTPUTS:
        raise ModelLoadError(f"Unexpected graph I/O: inputs {inputs}, outputs {outputs}")

    return DiseaseModel(
        version=release.version,
        onnx_sha256=release.onnx.sha256,
        session=session,
        sidecar=sidecar,
        class_keys=class_keys,
    )


def load_model_state(settings: Settings, config: InferenceConfig) -> ModelState:
    """Never raises: any failure becomes a not-ready state with a reason."""
    try:
        model = _load(settings, config)
    except Exception as exc:
        log.error("Disease model NOT loaded: %s", exc)
        return ModelState(error=str(exc))

    log.info(
        "Disease model v%s loaded (onnx sha256 %s..., %d classes)",
        model.version,
        model.onnx_sha256[:12],
        len(model.class_keys),
    )
    return ModelState(model=model)
