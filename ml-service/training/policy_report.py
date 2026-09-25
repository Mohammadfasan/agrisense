"""Final report: apply the inference policy (config/inference.yaml) to a data split."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import yaml

from app.core.classes import load_classes
from training.data import build_loaders
from training.model import build_model


@torch.no_grad()
def collect_logits(model, loader, device):
    model.eval()
    all_logits, all_labels = [], []
    for images, labels in loader:
        all_logits.append(model(images.to(device)).cpu())
        all_labels.append(labels)
    return torch.cat(all_logits), torch.cat(all_labels).numpy()


def crop_mask(
    logits: torch.Tensor, class_crops: np.ndarray, sample_crops: np.ndarray
) -> torch.Tensor:
    """Keep only the classes of each photo's crop (the app knows the plot's crop)."""
    allowed = class_crops[None, :] == sample_crops[:, None]  # (n_photos, n_classes)
    return logits.masked_fill(~torch.from_numpy(allowed), float("-inf"))


def apply_policy(probs, is_healthy, base, healthy):
    preds = probs.argmax(axis=1)
    conf = probs.max(axis=1)
    need = np.where(is_healthy[preds], max(base, healthy), base)
    return preds, conf >= need


def summarize(name, preds, diagnosed, labels, is_healthy) -> dict:
    wrong = diagnosed & (preds != labels)
    dangerous = wrong & is_healthy[preds] & ~is_healthy[labels]
    acc = float((preds[diagnosed] == labels[diagnosed]).mean()) if diagnosed.any() else 0.0
    return {
        "policy": name,
        "diagnosed": float(diagnosed.mean()),
        "escalated": float(1 - diagnosed.mean()),
        "accuracy_diagnosed": acc,
        "errors_passed": int(wrong.sum()),
        "dangerous_passed": int(dangerous.sum()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path("config/inference.yaml"))
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--split", choices=["val", "test"], default="test")
    parser.add_argument("--out-dir", type=Path, default=Path("reports"))
    parser.add_argument("--num-workers", type=int, default=0)
    args = parser.parse_args()

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    checkpoint = Path(cfg["model"]["checkpoint"])
    temperature = float(cfg["calibration"]["temperature"])
    base = float(cfg["thresholds"]["base"])
    healthy = float(cfg["thresholds"]["healthy"])

    classes = load_classes()
    keys = [c.key for c in classes]
    is_healthy = np.array([bool(c.is_healthy) for c in classes])
    class_crops = np.array([c.crop for c in classes])

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(checkpoint, map_location=device)
    if ckpt["class_names"] != keys:
        raise SystemExit("checkpoint class order does not match classes.yaml")
    model = build_model(num_classes=len(keys)).to(device)
    model.load_state_dict(ckpt["model_state"])

    loaders = build_loaders(args.data_root, keys, batch_size=64, num_workers=args.num_workers)
    loader = loaders.test if args.split == "test" else loaders.val
    logits, labels = collect_logits(model, loader, device)
    sample_crops = class_crops[labels]  # in the app, this comes from the plot

    # 1. Old rule: plain softmax, 0.50 for every class
    probs_old = torch.softmax(logits, dim=1).numpy()
    preds, diag = apply_policy(probs_old, is_healthy, 0.50, 0.50)
    rows = [summarize("old: 0.50, no calibration", preds, diag, labels, is_healthy)]

    # 2. New policy from inference.yaml
    probs_new = torch.softmax(logits / temperature, dim=1).numpy()
    preds, diag = apply_policy(probs_new, is_healthy, base, healthy)
    rows.append(
        summarize(
            f"new: T={temperature}, base {base}, healthy {healthy}", preds, diag, labels, is_healthy
        )
    )

    # 3. New policy + crop masking
    masked = crop_mask(logits, class_crops, sample_crops)
    probs_mask = torch.softmax(masked / temperature, dim=1).numpy()
    preds_m, diag_m = apply_policy(probs_mask, is_healthy, base, healthy)
    rows.append(summarize("new + crop masking", preds_m, diag_m, labels, is_healthy))

    print(f"\n=== Inference policy on {args.split} ({len(labels)} photos) ===\n")
    print(f"{'policy':<42} {'diagnosed':>9} {'acc(diag)':>9} {'errors':>7} {'dangerous':>9}")
    for r in rows:
        print(
            f"{r['policy']:<42} {r['diagnosed']:>9.1%} {r['accuracy_diagnosed']:>9.3f}"
            f" {r['errors_passed']:>7} {r['dangerous_passed']:>9}"
        )

    # Per-class view for the final policy: which crops will officers see most?
    print("\nPer class (new + crop masking):")
    print(f"  {'class':<24} {'photos':>6} {'escalated':>9} {'errors':>6}")
    per_class = []
    for c, key in enumerate(keys):
        m = labels == c
        esc = float((~diag_m[m]).mean())
        err = int((diag_m[m] & (preds_m[m] != c)).sum())
        per_class.append({"class": key, "photos": int(m.sum()), "escalated": esc, "errors": err})
        print(f"  {key:<24} {int(m.sum()):>6} {esc:>9.1%} {err:>6}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / f"policy_{args.split}.json"
    out.write_text(
        json.dumps(
            {"config": cfg, "split": args.split, "rows": rows, "per_class": per_class}, indent=2
        ),
        encoding="utf-8",
    )
    print(f"\nsaved to {out}")


if __name__ == "__main__":
    main()
