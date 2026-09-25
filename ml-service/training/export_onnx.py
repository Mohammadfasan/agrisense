"""Export the chosen model to ONNX and verify it matches PyTorch."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import yaml

from app.core.classes import load_classes
from training.data import build_loaders
from training.model import build_model


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def time_per_image(fn, x, runs: int = 50) -> float:
    fn(x)  # warm-up (first run is always slower)
    t0 = time.perf_counter()
    for _ in range(runs):
        fn(x)
    return (time.perf_counter() - t0) / runs * 1000  # milliseconds


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("config/inference.yaml"))
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--out", type=Path, default=Path("artifacts/agrisense_mobilenetv2.onnx"))
    args = parser.parse_args()

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    checkpoint = Path(cfg["model"]["checkpoint"])
    img_size = int(cfg["model"]["img_size"])

    keys = [c.key for c in load_classes()]
    ckpt = torch.load(checkpoint, map_location="cpu")
    if ckpt["class_names"] != keys:
        raise SystemExit("checkpoint class order does not match classes.yaml")

    model = build_model(num_classes=len(keys))
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    # 1. Export. Output = raw logits: temperature, thresholds and crop masking
    #    stay in config/inference.yaml and are applied by the service.
    dummy = torch.randn(1, 3, img_size, img_size)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        str(args.out),
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        external_data=False,
    )
    size_mb = args.out.stat().st_size / 1e6
    print(f"exported {args.out} ({size_mb:.1f} MB)")

    # 2. Verify on real val images: ONNX must give the same answers as PyTorch
    session = ort.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
    loaders = build_loaders(args.data_root, keys, batch_size=64, num_workers=0)
    images, _ = next(iter(loaders.val))

    with torch.no_grad():
        torch_logits = model(images).numpy()
    onnx_logits = session.run(["logits"], {"image": images.numpy()})[0]

    max_diff = float(np.abs(torch_logits - onnx_logits).max())
    same_pred = bool((torch_logits.argmax(1) == onnx_logits.argmax(1)).all())
    print(f"max logit difference: {max_diff:.2e}   same predictions: {same_pred}")
    if max_diff > 1e-3 or not same_pred:
        raise SystemExit("ONNX output does not match PyTorch - do not use this file")

    # 3. Speed on one image (CPU), like one farmer's scan
    one = images[:1]
    with torch.no_grad():
        torch_ms = time_per_image(lambda x: model(x), one)
    one_np = one.numpy()
    onnx_ms = time_per_image(lambda x: session.run(["logits"], {"image": x}), one_np)
    print(f"CPU time per image: PyTorch {torch_ms:.1f} ms, ONNX Runtime {onnx_ms:.1f} ms")

    # 4. Sidecar metadata: everything the service needs to use the file correctly
    meta = {
        "onnx_file": args.out.name,
        "sha256": sha256(args.out),
        "source_checkpoint": str(checkpoint),
        "source_epoch": ckpt["epoch"],
        "val_macro_f1": ckpt["val_macro_f1"],
        "class_names": keys,
        "img_size": img_size,
        "mean": list(ckpt["mean"]),
        "std": list(ckpt["std"]),
        "input": "image: float32 [batch, 3, 224, 224], RGB, ImageNet-normalised",
        "output": "logits: float32 [batch, 12], apply policy from inference.yaml",
        "verified_max_logit_diff": max_diff,
    }
    meta_path = args.out.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"saved {meta_path}")


if __name__ == "__main__":
    main()
