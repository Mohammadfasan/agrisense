"""Split data/raw/lab/ into train/val/test, resize, and write a manifest.

Splitting is GROUP-AWARE: near-duplicate groups from dedupe_check.py stay
inside one split, so the same leaf never appears in both train and test.
Deterministic: same input + same seed -> identical manifest hash.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.classes import ML_ROOT, RAW_LAB_DIR, load_classes

SEED = 42
RATIOS = {"train": 0.70, "val": 0.15, "test": 0.15}
RESIZE_TO = 256  # training will random-crop to 224
JPEG_QUALITY = 95

PROCESSED_DIR = ML_ROOT / "data" / "processed"
REPORTS_DIR = ML_ROOT / "reports"
DUPES_FILE = REPORTS_DIR / "duplicates.json"


def split_groups(group_to_files: dict[int, list[str]], rng: random.Random) -> dict[str, str]:
    """Assign whole groups to splits. Returns {filename: split}."""
    # Sort by group id first so the order never depends on dict iteration.
    groups = sorted(group_to_files.items())
    rng.shuffle(groups)

    n_files = sum(len(f) for _, f in groups)
    targets = {s: n_files * r for s, r in RATIOS.items()}
    counts = {s: 0 for s in RATIOS}
    assignment: dict[str, str] = {}

    # Biggest groups first, each into whichever split is furthest below target.
    for _gid, files in sorted(groups, key=lambda kv: -len(kv[1])):
        split = max(RATIOS, key=lambda s: targets[s] - counts[s])
        counts[split] += len(files)
        for f in files:
            assignment[f] = split
    return assignment


def main() -> None:
    if not DUPES_FILE.exists():
        sys.exit("run scripts/dedupe_check.py first")

    dupes = json.loads(DUPES_FILE.read_text(encoding="utf-8"))
    rng = random.Random(SEED)

    # Clean output so a re-run cannot mix old and new files.
    if PROCESSED_DIR.exists():
        import shutil

        shutil.rmtree(PROCESSED_DIR)

    rows: list[dict] = []
    for c in load_classes():
        info = dupes[c.key]
        corrupt = set(info["corrupt"])

        group_to_files: dict[int, list[str]] = {}
        for fname, gid in sorted(info["file_to_group"].items()):
            if fname in corrupt:
                continue
            group_to_files.setdefault(gid, []).append(fname)

        assignment = split_groups(group_to_files, rng)

        for fname in sorted(assignment):
            split = assignment[fname]
            src = RAW_LAB_DIR / c.key / fname
            dst_dir = PROCESSED_DIR / split / c.key
            dst_dir.mkdir(parents=True, exist_ok=True)
            dst = dst_dir / (Path(fname).stem + ".jpg")

            with Image.open(src) as im:
                im = im.convert("RGB").resize((RESIZE_TO, RESIZE_TO), Image.BICUBIC)
                im.save(dst, "JPEG", quality=JPEG_QUALITY)

            rows.append(
                {
                    "filepath": f"{split}/{c.key}/{dst.name}",
                    "class_key": c.key,
                    "class_id": c.id,
                    "split": split,
                    "source": c.source,
                    "group_id": f"{c.key}:{dupes[c.key]['file_to_group'][fname]}",
                }
            )

        per = {s: sum(1 for f, v in assignment.items() if v == s) for s in RATIOS}
        print(
            f"{c.key:24s} train {per['train']:5d}  val {per['val']:4d}  " f"test {per['test']:4d}"
        )

    # manifest.csv — sorted, so the hash is stable
    rows.sort(key=lambda r: r["filepath"])
    csv_path = ML_ROOT / "data" / "manifest.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    digest = hashlib.sha256(csv_path.read_bytes()).hexdigest()

    summary = {
        "seed": SEED,
        "ratios": RATIOS,
        "resize_to": RESIZE_TO,
        "total_images": len(rows),
        "per_split": {s: sum(1 for r in rows if r["split"] == s) for s in RATIOS},
        "per_class": {
            c.key: {
                s: sum(1 for r in rows if r["class_key"] == c.key and r["split"] == s)
                for s in RATIOS
            }
            for c in load_classes()
        },
        "manifest_sha256": digest,
    }
    (ML_ROOT / "data" / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\ntotal {len(rows)}  " + "  ".join(f"{s} {n}" for s, n in summary["per_split"].items()))
    print(f"manifest sha256: {digest[:16]}...")


if __name__ == "__main__":
    main()
