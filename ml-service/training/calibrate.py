"""Temperature scaling + threshold analysis, fitted on the val set only."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from torch import nn

from app.core.classes import load_classes
from training.data import build_loaders
from training.model import build_model

THRESHOLDS = [0.50, 0.60, 0.70, 0.80, 0.90, 0.95]
HEALTHY_THRESHOLDS = [0.50, 0.70, 0.80, 0.90, 0.95, 0.98]


@torch.no_grad()
def collect_logits(model, loader, device):
    model.eval()
    all_logits, all_labels = [], []
    for images, labels in loader:
        all_logits.append(model(images.to(device)).cpu())
        all_labels.append(labels)
    return torch.cat(all_logits), torch.cat(all_labels)


def fit_temperature(logits: torch.Tensor, labels: torch.Tensor) -> float:
    """Find T that makes softmax(logits / T) as honest as possible on val."""
    log_t = torch.zeros(1, requires_grad=True)  # T = exp(log_t): starts at 1.0, always > 0
    optimizer = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)
    nll = nn.CrossEntropyLoss()  # no class weights here: we want honest probabilities

    def closure():
        optimizer.zero_grad()
        loss = nll(logits / log_t.exp(), labels)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(log_t.detach().exp())


def expected_calibration_error(probs: np.ndarray, labels: np.ndarray, n_bins: int = 15) -> float:
    """Average gap between confidence and real accuracy (0 = perfectly honest)."""
    conf = probs.max(axis=1)
    correct = probs.argmax(axis=1) == labels
    edges = np.linspace(0, 1, n_bins + 1)
    total = 0.0
    for b in range(n_bins):
        mask = (conf > edges[b]) & (conf <= edges[b + 1])
        if mask.any():
            total += mask.mean() * abs(correct[mask].mean() - conf[mask].mean())
    return float(total)


def plot_reliability(probs_before, probs_after, labels, out_path: Path, n_bins: int = 10) -> None:
    fig, ax = plt.subplots(figsize=(6, 6))
    edges = np.linspace(0, 1, n_bins + 1)
    for name, probs in (("before", probs_before), ("after", probs_after)):
        conf = probs.max(axis=1)
        correct = probs.argmax(axis=1) == labels
        xs, ys = [], []
        for b in range(n_bins):
            mask = (conf > edges[b]) & (conf <= edges[b + 1])
            if mask.sum() >= 5:
                xs.append(conf[mask].mean())
                ys.append(correct[mask].mean())
        ax.plot(xs, ys, marker="o", label=name)
    ax.plot([0, 1], [0, 1], "k--", label="perfectly honest")
    ax.set_xlabel("confidence")
    ax.set_ylabel("real accuracy")
    ax.set_title("Reliability diagram (val)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def threshold_table(probs, labels, is_healthy, thresholds):
    """For each threshold: how many photos get a diagnosis, and how many mistakes pass."""
    conf = probs.max(axis=1)
    preds = probs.argmax(axis=1)
    rows = []
    for t in thresholds:
        diag = conf >= t
        wrong = diag & (preds != labels)
        dangerous = wrong & is_healthy[preds] & ~is_healthy[labels]
        rows.append(
            {
                "threshold": t,
                "coverage": float(diag.mean()),
                "errors_passed": int(wrong.sum()),
                "dangerous_passed": int(dangerous.sum()),
            }
        )
    return rows


def healthy_table(probs, labels, is_healthy, base_t, healthy_thresholds):
    """Stricter rule only for 'healthy' predictions."""
    conf = probs.max(axis=1)
    preds = probs.argmax(axis=1)
    pred_healthy = is_healthy[preds]
    rows = []
    for th in healthy_thresholds:
        need = np.where(pred_healthy, max(th, base_t), base_t)
        diag = conf >= need
        wrong = diag & (preds != labels)
        dangerous = wrong & pred_healthy & ~is_healthy[labels]
        healthy_escalated = ~diag & pred_healthy & is_healthy[labels]
        rows.append(
            {
                "healthy_threshold": th,
                "coverage": float(diag.mean()),
                "errors_passed": int(wrong.sum()),
                "dangerous_passed": int(dangerous.sum()),
                "healthy_leaves_escalated": int(healthy_escalated.sum()),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/finetune_best.pt"))
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--out-dir", type=Path, default=Path("reports"))
    parser.add_argument("--base-threshold", type=float, default=0.50)
    parser.add_argument("--num-workers", type=int, default=0)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(args.checkpoint, map_location=device)
    classes = load_classes()
    keys = [c.key for c in classes]
    if ckpt["class_names"] != keys:
        raise SystemExit("checkpoint class order does not match classes.yaml")
    is_healthy = np.array([bool(c.is_healthy) for c in classes])

    model = build_model(num_classes=len(keys)).to(device)
    model.load_state_dict(ckpt["model_state"])
    loaders = build_loaders(args.data_root, keys, batch_size=64, num_workers=args.num_workers)

    logits, labels_t = collect_logits(model, loaders.val, device)
    labels = labels_t.numpy()

    temperature = fit_temperature(logits, labels_t)
    probs_before = torch.softmax(logits, dim=1).numpy()
    probs_after = torch.softmax(logits / temperature, dim=1).numpy()

    ece_before = expected_calibration_error(probs_before, labels)
    ece_after = expected_calibration_error(probs_after, labels)
    print(f"temperature T = {temperature:.3f}")
    print(f"ECE before: {ece_before:.4f}   after: {ece_after:.4f}")
    same = (probs_before.argmax(1) == probs_after.argmax(1)).all()
    print(f"predictions unchanged: {bool(same)}")

    rows = threshold_table(probs_after, labels, is_healthy, THRESHOLDS)
    print(f"\nOne threshold for all (calibrated, val = {len(labels)} photos):")
    print("  thresh  diagnosed  errors_passed  dangerous_passed")
    for r in rows:
        print(
            f"  {r['threshold']:.2f}    {r['coverage']:7.1%}  {r['errors_passed']:>13}"
            f"  {r['dangerous_passed']:>16}"
        )

    hrows = healthy_table(probs_after, labels, is_healthy, args.base_threshold, HEALTHY_THRESHOLDS)
    print(f"\nBase threshold {args.base_threshold:.2f} + stricter rule for 'healthy':")
    print("  healthy_t  diagnosed  errors_passed  dangerous_passed  healthy_escalated")
    for r in hrows:
        print(
            f"  {r['healthy_threshold']:.2f}       {r['coverage']:7.1%}  {r['errors_passed']:>13}"
            f"  {r['dangerous_passed']:>16}  {r['healthy_leaves_escalated']:>17}"
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    plot_reliability(
        probs_before, probs_after, labels, args.out_dir / "calibration_reliability.png"
    )
    result = {
        "checkpoint": str(args.checkpoint),
        "fitted_on": "val",
        "temperature": temperature,
        "ece_before": ece_before,
        "ece_after": ece_after,
        "threshold_table": rows,
        "healthy_table": hrows,
    }
    (args.out_dir / "calibration_val.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(f"\nsaved to {args.out_dir}/ (calibration_val.json, calibration_reliability.png)")


if __name__ == "__main__":
    main()
