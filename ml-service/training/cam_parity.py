"""Parity test: ONNX in-graph CAM vs gradient-based Grad-CAM on real images.

The ADR claims that for our head (GAP -> Dropout -> Linear), Grad-CAM on
features[-1] equals CAM, so the service can get heatmaps from ONNX Runtime
without gradients. Step [3] of export_onnx.py proved the maths on random
noise; this script proves it on real validation photos.

It also checks that service-style preprocessing, driven ONLY by the sidecar
JSON, gives the same tensor as the torchvision val transform used in Week 4.

Pass criteria:
  - same predicted class from ONNX and PyTorch for every image
  - heatmap correlation >= 0.999 and max difference <= 1e-3 (after normalising)
  - preprocessing difference <= 1e-5

Run from ml-service/:
    python -m training.cam_parity
Outputs:
    reports/cam_parity/summary.json
    reports/cam_parity/*.png   (side-by-side figures for the thesis)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import onnxruntime as ort
import torch
import torch.nn.functional as F
from PIL import Image

from app.services.preprocess import InputSpec
from app.services.preprocess import preprocess as service_preprocess
from training.data import build_transforms
from training.export_onnx import (
    ARTIFACTS,
    ML_ROOT,
    build_model,
    load_checkpoint,
    load_class_keys,
)

VAL_DIR = ML_ROOT / "data" / "processed" / "val"
OUT_DIR = ML_ROOT / "reports" / "cam_parity"
ONNX_PATH = ARTIFACTS / "agrisense_mobilenetv2.onnx"
SIDECAR_PATH = ARTIFACTS / "agrisense_mobilenetv2.json"
CHECKPOINT = ARTIFACTS / "finetune_best.pt"

PER_CLASS = 2
N_FIGURES = 6
MIN_CORR = 0.999
MAX_DIFF = 1e-3
PREPROCESS_ATOL = 1e-5
EPS = 1e-8
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


# ---------- preprocessing (first draft of the service version) ----------


def preprocess(path: Path, spec: dict) -> np.ndarray:
    """Uses the SERVICE's preprocessing, so this test covers production code."""
    return service_preprocess(path.read_bytes(), InputSpec.from_sidecar(spec))[0]


# ---------- heatmaps ----------


def gradcam_reference(model: torch.nn.Module, x: torch.Tensor) -> tuple[np.ndarray, int]:
    """Textbook Grad-CAM on features[-1], using real gradients."""
    feats = model.features(x)  # (1, 1280, 7, 7)
    pooled = F.adaptive_avg_pool2d(feats, 1).flatten(1)
    logits = model.classifier(pooled)
    class_idx = int(logits[0].argmax())

    (grads,) = torch.autograd.grad(logits[0, class_idx], feats)
    alpha = grads.mean(dim=(2, 3), keepdim=True)  # one weight per feature map
    cam = F.relu((alpha * feats).sum(dim=1))[0]  # (7, 7)
    return cam.detach().numpy(), class_idx


def normalise(cam: np.ndarray) -> np.ndarray:
    return cam / (cam.max() + EPS)


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    if a.std() < EPS or b.std() < EPS:  # flat maps: corrcoef is undefined
        return 1.0 if np.allclose(a, b, atol=MAX_DIFF) else 0.0
    return float(np.corrcoef(a.ravel(), b.ravel())[0, 1])


def upsample(cam: np.ndarray, size: int) -> np.ndarray:
    return np.asarray(Image.fromarray(cam.astype(np.float32)).resize((size, size), Image.BILINEAR))


# ---------- figures ----------


def save_figure(
    out_path: Path, arr: np.ndarray, spec: dict, ref: np.ndarray, onx: np.ndarray, title: str
) -> None:
    mean = np.array(spec["mean"], dtype=np.float32)
    std = np.array(spec["std"], dtype=np.float32)
    img = np.clip(arr.transpose(1, 2, 0) * std + mean, 0, 1)
    size = img.shape[0]

    fig, axes = plt.subplots(1, 3, figsize=(9, 3.3))
    axes[0].imshow(img)
    axes[0].set_title("input", fontsize=9)
    panels = (
        (axes[1], ref, "Grad-CAM (PyTorch, gradients)"),
        (axes[2], onx, "CAM (ONNX Runtime, no gradients)"),
    )
    for ax, cam, name in panels:
        ax.imshow(img)
        ax.imshow(upsample(cam, size), cmap="jet", alpha=0.45)
        ax.set_title(name, fontsize=9)
    for ax in axes:
        ax.axis("off")
    fig.suptitle(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


# ---------- main ----------


def main() -> int:
    spec = json.loads(SIDECAR_PATH.read_text(encoding="utf-8"))["input"]
    class_keys = load_class_keys()

    model = build_model(len(class_keys))
    load_checkpoint(model, CHECKPOINT)
    session = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    tv_transform = build_transforms(False)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    records = []
    figures_saved = 0
    for key in class_keys:
        class_dir = VAL_DIR / key
        files = sorted(p for p in class_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
        for path in files[:PER_CLASS]:
            arr = preprocess(path, spec)

            with Image.open(path) as im:
                tv_arr = tv_transform(im.convert("RGB")).numpy()
            pre_diff = float(np.abs(arr - tv_arr).max())

            x_np = arr[None]  # add batch dimension -> (1, 3, 224, 224)
            ort_logits, ort_cams = session.run(["logits", "cams"], {"image": x_np})
            onnx_idx = int(ort_logits[0].argmax())
            onnx_cam = normalise(np.maximum(ort_cams[0, onnx_idx], 0))

            ref_raw, torch_idx = gradcam_reference(model, torch.from_numpy(x_np))
            ref_cam = normalise(ref_raw)

            rec = {
                "file": f"{key}/{path.name}",
                "true": key,
                "onnx_pred": class_keys[onnx_idx],
                "torch_pred": class_keys[torch_idx],
                "corr": correlation(ref_cam, onnx_cam),
                "max_diff": float(np.abs(ref_cam - onnx_cam).max()),
                "preprocess_diff": pre_diff,
            }
            records.append(rec)
            print(
                f"{rec['file']:<45} pred={rec['onnx_pred']:<26} "
                f"corr={rec['corr']:.5f}  diff={rec['max_diff']:.1e}  pre={pre_diff:.1e}"
            )

            if figures_saved < N_FIGURES and not key.endswith("healthy"):
                title = f"true: {key}   predicted: {rec['onnx_pred']}   corr {rec['corr']:.4f}"
                save_figure(OUT_DIR / f"{key}_{path.stem}.png", arr, spec, ref_cam, onnx_cam, title)
                figures_saved += 1

    summary = {
        "n_images": len(records),
        "min_corr": min(r["corr"] for r in records),
        "max_heatmap_diff": max(r["max_diff"] for r in records),
        "max_preprocess_diff": max(r["preprocess_diff"] for r in records),
        "all_same_prediction": all(r["onnx_pred"] == r["torch_pred"] for r in records),
        "correct_on_sample": sum(r["onnx_pred"] == r["true"] for r in records),
    }
    checks = {
        "same_prediction": summary["all_same_prediction"],
        "heatmap_corr": summary["min_corr"] >= MIN_CORR,
        "heatmap_diff": summary["max_heatmap_diff"] <= MAX_DIFF,
        "preprocessing": summary["max_preprocess_diff"] <= PREPROCESS_ATOL,
    }
    summary["checks"] = checks
    summary["passed"] = all(checks.values())
    (OUT_DIR / "summary.json").write_text(
        json.dumps({"summary": summary, "records": records}, indent=2), encoding="utf-8"
    )

    print("\n" + json.dumps(summary, indent=2))
    print("PASS" if summary["passed"] else "FAIL")
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
