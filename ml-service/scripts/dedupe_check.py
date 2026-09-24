"""Find near-duplicate and corrupt images in data/raw/lab/.

Near-duplicates are grouped so that prepare_dataset.py can keep every
group inside a single split. If the same leaf appears in both train and
test, test accuracy is inflated and meaningless.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import imagehash
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.classes import ML_ROOT, RAW_LAB_DIR, load_classes

HAMMING_THRESHOLD = 4  # <= 4 bits different  ->  near-duplicate
IMG_EXT = {".jpg", ".jpeg", ".png"}
REPORTS_DIR = ML_ROOT / "reports"


def hash_folder(folder: Path) -> tuple[dict[str, imagehash.ImageHash], list[str]]:
    """Return {filename: phash} and a list of corrupt filenames."""
    hashes: dict[str, imagehash.ImageHash] = {}
    corrupt: list[str] = []
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in IMG_EXT:
            continue
        try:
            with Image.open(f) as im:
                im = im.convert("RGB")
                hashes[f.name] = imagehash.phash(im)
        except Exception as exc:  # unreadable / truncated
            corrupt.append(f.name)
            print(f"    corrupt: {f.name}  ({type(exc).__name__})")
    return hashes, corrupt


def group_duplicates(hashes: dict[str, imagehash.ImageHash]) -> dict[str, int]:
    """Union-find over near-duplicate pairs. Returns {filename: group_id}."""
    names = list(hashes)
    parent = {n: n for n in names}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Bucket by the first 16 bits of the hash to avoid comparing every pair.
    buckets: dict[str, list[str]] = defaultdict(list)
    for n in names:
        buckets[str(hashes[n])[:4]].append(n)

    for bucket in buckets.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1 :]:
                if hashes[a] - hashes[b] <= HAMMING_THRESHOLD:
                    union(a, b)

    roots = {}
    groups: dict[str, int] = {}
    for n in names:
        r = find(n)
        if r not in roots:
            roots[r] = len(roots)
        groups[n] = roots[r]
    return groups


def main() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)
    report: dict[str, dict] = {}
    total_imgs = total_groups = total_corrupt = 0

    for c in load_classes():
        folder = RAW_LAB_DIR / c.key
        print(f"{c.key} ...", flush=True)

        hashes, corrupt = hash_folder(folder)
        groups = group_duplicates(hashes)
        n_groups = len(set(groups.values()))
        dupes = len(groups) - n_groups

        report[c.key] = {
            "images": len(groups),
            "groups": n_groups,
            "near_duplicates": dupes,
            "corrupt": corrupt,
            "file_to_group": groups,
        }
        total_imgs += len(groups)
        total_groups += n_groups
        total_corrupt += len(corrupt)

        pct = dupes / len(groups) * 100 if groups else 0
        print(
            f"  {len(groups):6d} images  {n_groups:6d} groups  "
            f"{dupes:5d} near-dupes ({pct:.1f}%)  {len(corrupt)} corrupt"
        )

    out = REPORTS_DIR / "duplicates.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(
        f"\nTOTAL  {total_imgs} images  {total_groups} groups  "
        f"{total_imgs - total_groups} near-dupes  {total_corrupt} corrupt"
    )
    print(f"written: {out}")


if __name__ == "__main__":
    main()
