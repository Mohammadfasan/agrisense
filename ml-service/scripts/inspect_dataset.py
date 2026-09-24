"""Build the dataset report: distribution chart + dataset_summary.md."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no GUI needed
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.classes import ML_ROOT, load_classes

REPORTS_DIR = ML_ROOT / "reports"
RISK_THRESHOLD = 200  # fewer images than this = HIGH RISK
SPLITS = ["train", "val", "test"]


def main() -> None:
    manifest = json.loads((ML_ROOT / "data" / "manifest.json").read_text("utf-8"))
    dupes = json.loads((REPORTS_DIR / "duplicates.json").read_text("utf-8"))
    per_class = manifest["per_class"]
    classes = load_classes()

    totals = {c.key: sum(per_class[c.key].values()) for c in classes}
    biggest = max(totals, key=totals.get)
    smallest = min(totals, key=totals.get)
    imbalance = totals[biggest] / totals[smallest]

    # ---------- chart ----------
    keys = [c.key for c in classes]
    bottom = [0] * len(keys)
    fig, ax = plt.subplots(figsize=(11, 6))
    for split in SPLITS:
        vals = [per_class[k][split] for k in keys]
        ax.bar(keys, vals, bottom=bottom, label=split)
        bottom = [b + v for b, v in zip(bottom, vals, strict=False)]
    ax.set_ylabel("images")
    ax.set_title("AgriSense dataset — class distribution by split")
    ax.legend()
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    chart = REPORTS_DIR / "class_distribution.png"
    plt.savefig(chart, dpi=150)
    plt.close()

    # ---------- markdown ----------
    L = ["# AgriSense dataset summary", ""]
    L += [
        f"- Total images: **{manifest['total_images']}**",
        f"- Classes: **{len(classes)}**",
        f"- Split: {manifest['ratios']} (seed {manifest['seed']})",
        f"- Resized to: {manifest['resize_to']}x{manifest['resize_to']}",
        f"- Manifest SHA256: `{manifest['manifest_sha256']}`",
        "",
    ]
    L += [
        "## Per class",
        "",
        "| class | crop | source | train | val | test | total | " "groups | near-dupes | risk |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    for c in classes:
        p = per_class[c.key]
        t = totals[c.key]
        d = dupes[c.key]
        risk = "**HIGH RISK**" if t < RISK_THRESHOLD else ""
        L.append(
            f"| {c.key} | {c.crop} | {c.source} | {p['train']} | "
            f"{p['val']} | {p['test']} | {t} | {d['groups']} | "
            f"{d['near_duplicates']} | {risk} |"
        )

    L += [
        "",
        "## Findings",
        "",
        f"- Imbalance ratio: **{imbalance:.1f}x** "
        f"({biggest} = {totals[biggest]}, {smallest} = {totals[smallest]})",
        f"- Total near-duplicate images removed from independent counting: "
        f"{sum(d['near_duplicates'] for d in dupes.values())}",
        f"- Corrupt files skipped: " f"{sum(len(d['corrupt']) for d in dupes.values())}",
        "",
        "Near-duplicate groups are kept inside a single split, so the same "
        "leaf never appears in both training and test data.",
        "",
    ]

    risky = [c.key for c in classes if totals[c.key] < RISK_THRESHOLD]
    if risky:
        L += ["### High-risk classes", ""]
        L += [
            f"- `{k}` — only {totals[k]} images; plan class weights, "
            f"stronger augmentation, and additional field photos."
            for k in risky
        ]
        L.append("")

    L += [
        "### Sources",
        "",
        "- `plantvillage` — lab photographs, uniform background",
        "- `paddy_doctor` — field photographs, natural background",
        "",
        "Each crop's healthy and diseased classes come from the same "
        "source, so the model cannot separate them by source alone.",
        "",
    ]

    (REPORTS_DIR / "dataset_summary.md").write_text("\n".join(L), "utf-8")

    print(f"imbalance {imbalance:.1f}x   high-risk: {risky or 'none'}")
    print(f"written: {chart}")
    print(f"written: {REPORTS_DIR / 'dataset_summary.md'}")


if __name__ == "__main__":
    main()
