"""Export the fine-tuned model to ONNX with two outputs: logits and cams.

The exported graph is LogitsAndCams (see training/onnx_wrapper.py), so one
forward pass in ONNX Runtime gives the prediction AND the class heatmaps.
PyTorch is therefore not needed in the service (see ADR in architecture.md).

Checks before the file is accepted:
  1. Wrapper logits == original model logits        (PyTorch vs PyTorch)
  2. ONNX Runtime outputs == wrapper outputs        (ONNX vs PyTorch)
  3. Batch size is dynamic (checked with batch = 4)
  4. Weights are embedded in one .onnx file (no external .data file)

Run from ml-service/:
    python -m training.export_onnx
    python -m training.export_onnx --checkpoint artifacts/finetune_best.pt
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn
from torchvision.models import mobilenet_v2

from app.core.classes import load_classes
from training.onnx_wrapper import LogitsAndCams, check_same_logits

ML_ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ML_ROOT / "artifacts"

MODEL_VERSION = "1.0.0"
OPSET = 18
INPUT_SIZE = 224  # training/data.py: CenterCrop(IMG_SIZE)
RESIZE_TO = 256  # scripts/prepare_dataset.py: stretch to square, BICUBIC
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

LOGITS_ATOL = 1e-4
CAMS_ATOL = 1e-3  # cams are larger numbers than logits, so a looser tolerance


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_class_keys() -> list[str]:
    """Class keys in id order, from the validated loader (app/core/classes.py)."""
    return [c.key for c in load_classes()]


def build_model(num_classes: int) -> nn.Module:
    """Same architecture as training/model.py.

    Dropout's value does not matter here (it is off at inference and has no
    weights). load_state_dict(strict=True) below fails if anything else
    differs from the trained model.
    """
    model = mobilenet_v2(weights=None)
    in_features = model.classifier[1].in_features  # 1280
    model.classifier = nn.Sequential(
        nn.Dropout(0.2),
        nn.Linear(in_features, num_classes),
    )
    return model


def load_checkpoint(model: nn.Module, path: Path) -> None:
    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=True)
    except Exception:
        # Our own file (trusted); it may contain non-tensor extras like history.
        ckpt = torch.load(path, map_location="cpu", weights_only=False)

    if isinstance(ckpt, dict):
        for key in ("model_state_dict", "state_dict", "model_state", "model"):
            if key in ckpt and isinstance(ckpt[key], dict):
                ckpt = ckpt[key]
                break

    model.load_state_dict(ckpt, strict=True)
    model.eval()


def export(wrapper: LogitsAndCams, out_path: Path) -> None:
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE)
    torch.onnx.export(
        wrapper,
        (dummy,),
        str(out_path),
        input_names=["image"],
        output_names=["logits", "cams"],
        dynamic_axes={
            "image": {0: "batch"},
            "logits": {0: "batch"},
            "cams": {0: "batch"},
        },
        opset_version=OPSET,
        dynamo=False,
    )

    # Re-save so all weights are inside the single .onnx file.
    model_proto = onnx.load(str(out_path))
    onnx.checker.check_model(model_proto)
    onnx.save_model(model_proto, str(out_path), save_as_external_data=False)
    stray = out_path.with_name(out_path.name + ".data")
    if stray.exists():
        stray.unlink()


def verify_with_onnxruntime(wrapper: LogitsAndCams, onnx_path: Path) -> dict:
    x = torch.randn(4, 3, INPUT_SIZE, INPUT_SIZE)  # batch of 4 tests dynamic batch

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ort_logits, ort_cams = session.run(["logits", "cams"], {"image": x.numpy()})

    with torch.no_grad():
        pt_logits, pt_cams = wrapper(x)

    logits_diff = float(np.abs(ort_logits - pt_logits.numpy()).max())
    cams_diff = float(np.abs(ort_cams - pt_cams.numpy()).max())
    same_argmax = bool((ort_logits.argmax(axis=1) == pt_logits.numpy().argmax(axis=1)).all())

    if logits_diff > LOGITS_ATOL or cams_diff > CAMS_ATOL or not same_argmax:
        raise AssertionError(
            f"ONNX Runtime mismatch: logits {logits_diff:.2e}, "
            f"cams {cams_diff:.2e}, same argmax {same_argmax}"
        )

    return {
        "ort_vs_torch_max_logits_diff": logits_diff,
        "ort_vs_torch_max_cams_diff": cams_diff,
        "cams_shape": list(ort_cams.shape[1:]),
    }


def write_sidecar(onnx_path: Path, ckpt_path: Path, class_keys: list[str], parity: dict) -> Path:
    h, w = parity["cams_shape"][1:]
    sidecar = {
        "model_version": MODEL_VERSION,
        "architecture": "mobilenet_v2",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "onnx": {
            "file": onnx_path.name,
            "sha256": sha256_of(onnx_path),
            "size_bytes": onnx_path.stat().st_size,
            "opset": OPSET,
        },
        "source_checkpoint": {
            "file": ckpt_path.name,
            "sha256": sha256_of(ckpt_path),
        },
        "input": {
            "name": "image",
            "shape": ["batch", 3, INPUT_SIZE, INPUT_SIZE],
            "dtype": "float32",
            "layout": "NCHW",
            "resize_to": RESIZE_TO,
            "resample": "bicubic",
            "keep_aspect_ratio": False,
            "center_crop": INPUT_SIZE,
            "mean": IMAGENET_MEAN,
            "std": IMAGENET_STD,
            "preprocess": [
                "apply EXIF orientation",
                "convert to RGB",
                f"resize to {RESIZE_TO}x{RESIZE_TO}, bicubic, aspect ratio not kept",
                f"center crop {INPUT_SIZE}x{INPUT_SIZE}",
                "divide by 255, then normalise with mean/std",
            ],
        },
        "outputs": {
            "logits": {
                "shape": ["batch", len(class_keys)],
                "note": "temperature NOT applied",
            },
            "cams": {
                "shape": ["batch", len(class_keys), h, w],
                "note": "raw CAM per class, before ReLU and normalising",
            },
        },
        "classes": class_keys,
        "parity": parity,
    }
    sidecar_path = onnx_path.with_suffix(".json")
    sidecar_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return sidecar_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--checkpoint", type=Path, default=ARTIFACTS / "finetune_best.pt")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "agrisense_mobilenetv2.onnx")
    args = parser.parse_args()

    class_keys = load_class_keys()
    model = build_model(len(class_keys))
    load_checkpoint(model, args.checkpoint)
    print(f"Loaded {args.checkpoint.name} ({len(class_keys)} classes)")

    wrapper = LogitsAndCams(model).eval()
    x = torch.randn(4, 3, INPUT_SIZE, INPUT_SIZE)
    wrapper_diff = check_same_logits(model, wrapper, x, atol=LOGITS_ATOL)
    print(f"[1] wrapper vs model  max logits diff: {wrapper_diff:.2e}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    export(wrapper, args.out)
    print(f"[2] exported -> {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")

    parity = verify_with_onnxruntime(wrapper, args.out)
    parity["wrapper_vs_model_max_logits_diff"] = wrapper_diff
    print(
        f"[3] ONNX Runtime vs PyTorch  logits {parity['ort_vs_torch_max_logits_diff']:.2e}"
        f"  cams {parity['ort_vs_torch_max_cams_diff']:.2e}"
        f"  cams shape {parity['cams_shape']}"
    )

    sidecar = write_sidecar(args.out, args.checkpoint, class_keys, parity)
    print(f"[4] sidecar -> {sidecar}")
    print("OK")


if __name__ == "__main__":
    main()
