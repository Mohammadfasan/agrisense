"""Evaluate a checkpoint: per-class metrics, confusion matrix, confidence threshold check."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix

from app.core.classes import load_classes
from training.data import build_loaders
from training.model import build_model

CONFIDENCE_THRESHOLD = 0.50  # below this: no diagnosis, escalate to an officer


@torch.no_grad()
def predict(model, loader, device):
    model.eval()
    all_probs, all_labels = [], []
    for images, labels in loader:
        logits = model(images.to(device))
        all_probs.append(torch.softmax(logits, dim=1).cpu())
        all_labels.append(labels)
    return torch.cat(all_probs).numpy(), torch.cat(all_labels).numpy()


def plot_confusion(cm: np.ndarray, class_names: list[str], out_path: Path) -> None:
    cm_norm = cm / cm.sum(axis=1, keepdims=True)  # each row sums to 1 (= recall)
    n = len(class_names)
    fig, ax = plt.subplots(figsize=(10, 9))
    im = ax.imshow(cm_norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(n), class_names, rotation=60, ha="right")
    ax.set_yticks(range(n), class_names)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    for i in range(n):
        for j in range(n):
            if cm[i, j] > 0:
                color = "white" if cm_norm[i, j] > 0.5 else "black"
                ax.text(j, i, str(cm[i, j]), ha="center", va="center", fontsize=8, color=color)
    fig.colorbar(im, ax=ax, label="fraction of the true class")
    ax.set_title("Confusion matrix (numbers = counts, colour = row %)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/baseline_best.pt"))
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--split", choices=["val", "test"], default="val")
    parser.add_argument("--out-dir", type=Path, default=Path("reports"))
    parser.add_argument("--num-workers", type=int, default=0)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(args.checkpoint, map_location=device)

    # Fail fast: the checkpoint must use the same class order as classes.yaml
    class_names = ckpt["class_names"]
    keys = [c.key for c in load_classes()]
    if class_names != keys:
        raise SystemExit(f"Class mismatch!\n  checkpoint: {class_names}\n  yaml: {keys}")

    model = build_model(num_classes=len(class_names)).to(device)
    model.load_state_dict(ckpt["model_state"])
    print(
        f"loaded {args.checkpoint} (epoch {ckpt['epoch']}, val macro-F1 {ckpt['val_macro_f1']:.3f})"
    )

    loaders = build_loaders(args.data_root, keys, batch_size=64, num_workers=args.num_workers)
    loader = loaders.test if args.split == "test" else loaders.val

    probs, y = predict(model, loader, device)
    preds = probs.argmax(axis=1)
    conf = probs.max(axis=1)

    # 1. Per-class precision / recall / F1
    report = classification_report(y, preds, target_names=class_names, digits=3, zero_division=0)
    report_dict = classification_report(
        y, preds, target_names=class_names, zero_division=0, output_dict=True
    )
    print(f"\n=== {args.split} set: {len(y)} images ===\n")
    print(report)

    # 2. Biggest mistakes
    n = len(class_names)
    cm = confusion_matrix(y, preds, labels=list(range(n)))
    off = cm.copy()
    np.fill_diagonal(off, 0)
    pairs = sorted(
        (
            (int(off[i, j]), class_names[i], class_names[j])
            for i in range(n)
            for j in range(n)
            if off[i, j] > 0
        ),
        reverse=True,
    )[:8]
    print("Top confusions (true -> predicted):")
    for count, true_name, pred_name in pairs:
        print(f"  {count:>3}  {true_name} -> {pred_name}")

    # 3. Confidence threshold check
    confident = conf >= CONFIDENCE_THRESHOLD
    coverage = float(confident.mean())
    acc_all = float((preds == y).mean())
    acc_confident = float((preds[confident] == y[confident]).mean()) if confident.any() else 0.0
    print(f"\nConfidence >= {CONFIDENCE_THRESHOLD}:")
    print(f"  diagnosed      : {coverage:.1%} of photos (rest escalated to officer)")
    print(f"  accuracy (all) : {acc_all:.3f}")
    print(f"  accuracy (diagnosed only): {acc_confident:.3f}")

    # 4. Save everything
    args.out_dir.mkdir(parents=True, exist_ok=True)
    tag = f"{args.checkpoint.stem}_{args.split}"
    (args.out_dir / f"eval_{tag}.txt").write_text(report, encoding="utf-8")
    plot_confusion(cm, class_names, args.out_dir / f"confusion_{tag}.png")
    summary = {
        "checkpoint": str(args.checkpoint),
        "split": args.split,
        "n_images": int(len(y)),
        "accuracy": acc_all,
        "macro_f1": report_dict["macro avg"]["f1-score"],
        "threshold": CONFIDENCE_THRESHOLD,
        "coverage": coverage,
        "accuracy_diagnosed": acc_confident,
        "top_confusions": pairs,
    }
    (args.out_dir / f"eval_{tag}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nsaved to {args.out_dir}/ (eval_{tag}.txt, .json, confusion_{tag}.png)")


if __name__ == "__main__":
    main()
