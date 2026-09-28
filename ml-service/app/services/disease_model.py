from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import onnxruntime as ort

from app.core.classes import load_classes
from app.core.config import Settings
from app.core.inference_config import InferenceConfig
from app.services.heatmap import Heatmap, build_heatmap
from app.services.policy import Decision, DecisionPolicy
from app.services.preprocess import InputSpec, preprocess

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
class Prediction:
    """Everything the API needs to answer one scan."""

    model_version: str
    decision: Decision
    heatmap: Heatmap | None
    inference_ms: float


@dataclass(frozen=True)
class DiseaseModel:
    """A verified, loaded model. Only created when every check has passed."""

    version: str
    onnx_sha256: str
    session: ort.InferenceSession
    sidecar: dict[str, Any]
    class_keys: list[str]
    spec: InputSpec
    policy: DecisionPolicy

    @property
    def input_spec(self) -> dict[str, Any]:
        return self.sidecar["input"]

    def predict(self, data: bytes) -> Prediction:
        """Diagnose one uploaded photo.

        Raises InvalidImageError (from preprocess) when the upload is not a
        usable photo - the API turns that into a 400 with a safe message.
        ONNX Runtime sessions are thread-safe, so FastAPI's worker threads
        can call this at the same time.
        """
        start = time.perf_counter()

        x = preprocess(data, self.spec)
        logits, cams = self.session.run(EXPECTED_OUTPUTS, {EXPECTED_INPUTS[0]: x})
        decision = self.policy.decide(logits[0])

        # A heatmap for a "healthy" class has no meaning, so only diseases get one.
        heatmap = (
            None if decision.is_healthy else build_heatmap(cams[0, decision.class_index], self.spec)
        )

        return Prediction(
            model_version=self.version,
            decision=decision,
            heatmap=heatmap,
            inference_ms=round((time.perf_counter() - start) * 1000, 1),
        )


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

    # 5. Preprocessing recipe and decision policy, validated once here
    spec = InputSpec.from_sidecar(sidecar["input"])
    policy = DecisionPolicy.from_config(config)

    return DiseaseModel(
        version=release.version,
        onnx_sha256=release.onnx.sha256,
        session=session,
        sidecar=sidecar,
        class_keys=class_keys,
        spec=spec,
        policy=policy,
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
