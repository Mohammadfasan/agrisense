"""Split the raw crop-disease corpus into train/val/test and resize it.

Reads ``data/raw/<class_name>/*.jpg``, splits each class 70/15/15 with a fixed
seed, resizes every image to 224x224 RGB JPEG, and writes
``data/processed/<split>/<class_name>/``. A run ends by writing
``data/manifest.json`` -- the record of what the split was, which is what a
reported accuracy is checkable against.

Nothing here downloads and nothing here trains. See ``data/README.md``.

Usage::

    python scripts/prepare_dataset.py --dry-run     # counts only, writes nothing
    python scripts/prepare_dataset.py
    python scripts/prepare_dataset.py --seed 7 --size 256
"""

from __future__ import annotations

import argparse
import json
import math
import random
import shutil
import sys
from collections import OrderedDict
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

SERVICE_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_RAW = SERVICE_ROOT / "data" / "raw"
DEFAULT_PROCESSED = SERVICE_ROOT / "data" / "processed"
DEFAULT_MANIFEST = SERVICE_ROOT / "data" / "manifest.json"

SPLITS = ("train", "val", "test")
DEFAULT_RATIOS = (0.70, 0.15, 0.15)
DEFAULT_SEED = 42
DEFAULT_SIZE = 224
DEFAULT_MIN_PER_CLASS = 100
JPEG_QUALITY = 90

# Extensions worth opening. The corpus is nominally .jpg, but every published
# plant-disease set has a few PNGs in it, and dropping them silently would make
# the counts in the manifest disagree with what is on disk.
IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})


def display_path(path: Path) -> str:
    """``path`` relative to the service root when it is under it, else absolute.

    ``Path.relative_to`` raises rather than falling back, and these scripts
    accept ``--dir`` and ``--reports`` anywhere on the filesystem, so the
    plain call turns a successful run into a traceback on the last line.
    """
    try:
        return str(path.relative_to(SERVICE_ROOT))
    except ValueError:
        return str(path)


class PrepareError(RuntimeError):
    """A run could not proceed. Reported to the operator, not a traceback."""


# --------------------------------------------------------------------------- #
# Discovery                                                                     #
# --------------------------------------------------------------------------- #


def discover_classes(raw_dir: Path) -> OrderedDict[str, list[Path]]:
    """Every class directory under ``raw_dir``, with its image files.

    Sorted at both levels, and that is load-bearing rather than tidiness:
    the split is a seeded shuffle, and a shuffle is only reproducible if what
    it shuffles arrives in the same order every time. ``Path.iterdir`` does
    not promise one.
    """
    if not raw_dir.is_dir():
        raise PrepareError(
            f"No raw directory at {raw_dir}\n"
            "Create it and put one directory per class inside -- see data/README.md."
        )

    classes: OrderedDict[str, list[Path]] = OrderedDict()
    for entry in sorted(raw_dir.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        files = sorted(
            (f for f in entry.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_SUFFIXES),
            key=lambda p: p.name,
        )
        classes[entry.name] = files

    if not classes:
        raise PrepareError(
            f"{raw_dir} has no class directories in it.\n"
            "Expected data/raw/<class_name>/*.jpg -- see data/README.md."
        )
    return classes


# --------------------------------------------------------------------------- #
# Splitting                                                                     #
# --------------------------------------------------------------------------- #


def split_counts(n: int, ratios: tuple[float, float, float]) -> tuple[int, int, int]:
    """How many of ``n`` images go to train, val and test.

    Largest-remainder rather than three roundings, so the three always sum back
    to ``n`` exactly -- rounding each independently loses or invents an image,
    and a manifest whose parts do not add up to its total is a manifest nobody
    will trust when the numbers matter.

    A class with at least three images is guaranteed one in ``val`` and one in
    ``test``. Below 70/15/15 that would otherwise floor to zero, and an empty
    test split reports as 100% accuracy for the class rather than as no
    measurement at all -- the one failure mode here that flatters a result.
    """
    exact = [n * r for r in ratios]
    counts = [math.floor(value) for value in exact]

    # Hand out what flooring dropped, to whichever splits lost the most.
    remainder = n - sum(counts)
    order = sorted(range(len(ratios)), key=lambda i: exact[i] - counts[i], reverse=True)
    for index in order[:remainder]:
        counts[index] += 1

    if n >= 3:
        for index in (1, 2):
            if counts[index] == 0:
                counts[index] = 1
                counts[0] -= 1

    return counts[0], counts[1], counts[2]


def split_class(
    files: list[Path], ratios: tuple[float, float, float], seed: int, class_name: str
) -> dict[str, list[Path]]:
    """One class's files, shuffled and cut into the three splits.

    Seeded per class with ``seed`` and the class name, not with ``seed`` alone.
    A single shared generator would make every class's shuffle depend on how
    many files the classes before it happened to have, so adding an image to
    the first class would re-split all the others -- reproducible only in the
    sense that a whole rebuild reproduces itself.
    """
    shuffled = list(files)
    random.Random(f"{seed}:{class_name}").shuffle(shuffled)

    n_train, n_val, _ = split_counts(len(shuffled), ratios)
    return {
        "train": shuffled[:n_train],
        "val": shuffled[n_train : n_train + n_val],
        "test": shuffled[n_train + n_val :],
    }


# --------------------------------------------------------------------------- #
# Image conversion                                                              #
# --------------------------------------------------------------------------- #


def load_square(path: Path, size: int, mode: str) -> Image.Image:
    """Open one image and return it as ``size``x``size`` RGB.

    ``exif_transpose`` first, always. A phone writes the sensor's own pixels
    and an orientation tag beside them, so an image that displays upright in a
    gallery is stored on its side; resizing without applying the tag trains the
    model on rotations that no camera ever produces.

    Modes:

    ``cover``
        Scale until the short side fits, then centre-crop. Keeps the aspect
        ratio and fills the frame. The default because published leaf-disease
        images are framed on a single centred leaf, so the edges are background.
    ``pad``
        Scale until the long side fits, then letterbox. Loses nothing, at the
        cost of bars the model has to learn to ignore. Use it for field photos
        where the lesion may be anywhere in frame.
    ``stretch``
        Resize to the square and accept the distortion. Here to be measured
        against, not recommended.
    """
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened) or opened
        # Convert after transposing, and before resizing: palette and CMYK
        # images resample wrongly in their own mode.
        image = image.convert("RGB")

        if mode == "stretch":
            return image.resize((size, size), Image.Resampling.LANCZOS)
        if mode == "pad":
            padded = ImageOps.contain(image, (size, size), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (size, size), (0, 0, 0))
            canvas.paste(padded, ((size - padded.width) // 2, (size - padded.height) // 2))
            return canvas
        return ImageOps.fit(image, (size, size), Image.Resampling.LANCZOS, centering=(0.5, 0.5))


# --------------------------------------------------------------------------- #
# Reporting                                                                     #
# --------------------------------------------------------------------------- #


def print_raw_table(classes: OrderedDict[str, list[Path]], min_per_class: int) -> list[str]:
    """The per-class count table, before anything is written.

    Returns the classes under ``min_per_class`` so the caller can record them
    in the manifest rather than re-deriving the same rule somewhere else.
    """
    width = max((len(name) for name in classes), default=5)
    total = sum(len(files) for files in classes.values())

    print("\nRaw corpus")
    print(f"  {'class'.ljust(width)}  {'images':>7}  {'share':>7}")
    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}")

    low: list[str] = []
    for name, files in classes.items():
        count = len(files)
        share = (count / total * 100) if total else 0.0
        flag = ""
        if count < min_per_class:
            low.append(name)
            flag = f"  <- under {min_per_class}"
        print(f"  {name.ljust(width)}  {count:>7}  {share:>6.1f}%{flag}")

    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}")
    print(f"  {'total'.ljust(width)}  {total:>7}")
    return low


def print_split_table(per_class: OrderedDict[str, dict[str, int]]) -> None:
    """The same table again, after the split, so the two can be compared."""
    width = max((len(name) for name in per_class), default=5)

    print("\nAfter the split")
    header = f"  {'class'.ljust(width)}  {'train':>7}  {'val':>7}  {'test':>7}  {'written':>7}"
    print(header)
    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}  {'-' * 7}  {'-' * 7}")

    totals = dict.fromkeys(SPLITS, 0)
    written_total = 0
    for name, counts in per_class.items():
        written = sum(counts[split] for split in SPLITS)
        written_total += written
        for split in SPLITS:
            totals[split] += counts[split]
        print(
            f"  {name.ljust(width)}  {counts['train']:>7}  "
            f"{counts['val']:>7}  {counts['test']:>7}  {written:>7}"
        )

    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}  {'-' * 7}  {'-' * 7}")
    print(
        f"  {'total'.ljust(width)}  {totals['train']:>7}  "
        f"{totals['val']:>7}  {totals['test']:>7}  {written_total:>7}"
    )


def warn_low_counts(low: list[str], min_per_class: int) -> None:
    """Say what a thin class actually costs, rather than only that it is thin."""
    if not low:
        return

    print(f"\nRISK: {len(low)} class(es) under {min_per_class} raw images:")
    for name in low:
        print(f"  - {name}")
    print(
        "  At this size the 15% test split is a handful of images, so that class's\n"
        "  test accuracy moves in steps of several percentage points and supports no\n"
        "  claim about the class. Collect more, or merge it into a neighbour.\n"
        "  This is a warning, not a failure -- the run continues."
    )


# --------------------------------------------------------------------------- #
# The run                                                                       #
# --------------------------------------------------------------------------- #


def prepare_output_dirs(processed: Path, classes: list[str], force: bool) -> None:
    """Make the split/class tree, clearing a previous run's output first.

    Cleared rather than written over. A previous run under a different seed
    leaves images in splits this one did not choose, and a corpus that is
    partly one split and partly another is the kind of leak that does not show
    up until a test accuracy is too good to publish.
    """
    for split in SPLITS:
        split_dir = processed / split
        for name in classes:
            target = split_dir / name
            if target.exists():
                if not force:
                    raise PrepareError(
                        f"{target} already holds a previous run.\n"
                        "Re-run with --force to replace it, or point --processed elsewhere."
                    )
                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)


def run(args: argparse.Namespace) -> int:
    ratios = (args.train_ratio, args.val_ratio, args.test_ratio)
    if not math.isclose(sum(ratios), 1.0, abs_tol=1e-6):
        raise PrepareError(f"Split ratios must sum to 1.0, got {sum(ratios):.4f}")

    classes = discover_classes(args.raw)
    low = print_raw_table(classes, args.min_per_class)
    warn_low_counts(low, args.min_per_class)

    empty = [name for name, files in classes.items() if not files]
    if empty:
        raise PrepareError(
            "These class directories hold no readable image files: " + ", ".join(empty)
        )

    planned = {name: split_class(files, ratios, args.seed, name) for name, files in classes.items()}

    if args.dry_run:
        print_split_table(
            OrderedDict(
                (name, {split: len(paths) for split, paths in splits.items()})
                for name, splits in planned.items()
            )
        )
        print("\nDry run: nothing was written, and no manifest was updated.")
        return 0

    prepare_output_dirs(args.processed, list(classes), args.force)

    per_class: OrderedDict[str, dict[str, int]] = OrderedDict()
    unreadable: list[str] = []

    for name, splits in planned.items():
        counts = dict.fromkeys(SPLITS, 0)
        for split, paths in splits.items():
            target_dir = args.processed / split / name
            for source in paths:
                try:
                    image = load_square(source, args.size, args.resize_mode)
                except (OSError, UnidentifiedImageError, ValueError) as exc:
                    # One unreadable file must not lose the other nine thousand.
                    # It is counted, named in the manifest, and skipped.
                    unreadable.append(str(source.relative_to(args.raw.parent)))
                    print(f"  skipped (unreadable): {source.name} -- {exc}", file=sys.stderr)
                    continue

                # Always .jpg on the way out, whatever came in: the loader
                # downstream globs one extension, and a stray .png in a
                # processed directory is a file it will silently not train on.
                image.save(target_dir / f"{source.stem}.jpg", "JPEG", quality=JPEG_QUALITY)
                counts[split] += 1
        per_class[name] = counts

    print_split_table(per_class)
    if unreadable:
        print(f"\n{len(unreadable)} file(s) could not be read and were skipped.")

    manifest = build_manifest(args, ratios, classes, per_class, low, unreadable)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {display_path(args.manifest)}")
    print(f"Wrote {sum(sum(c.values()) for c in per_class.values())} images to {args.processed}")
    return 0


def build_manifest(
    args: argparse.Namespace,
    ratios: tuple[float, float, float],
    classes: OrderedDict[str, list[Path]],
    per_class: OrderedDict[str, dict[str, int]],
    low: list[str],
    unreadable: list[str],
) -> dict:
    """Everything needed to rebuild this exact split, and nothing else.

    The seed and the ratios are the reproducible part; the counts are what a
    written-up result is checked against. Both belong in one file, under
    version control -- see ``data/README.md``.
    """
    totals = {split: sum(counts[split] for counts in per_class.values()) for split in SPLITS}

    return {
        "created_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": args.seed,
        # From the validated tuple, not from `args`, so what is recorded is
        # what the split actually used.
        "ratios": dict(zip(SPLITS, ratios, strict=True)),
        "image_size": [args.size, args.size],
        "resize_mode": args.resize_mode,
        "jpeg_quality": JPEG_QUALITY,
        "source": display_path(args.raw),
        "classes": list(classes),
        "totals": {"raw": sum(len(f) for f in classes.values()), **totals},
        "per_class": {name: {"raw": len(classes[name]), **per_class[name]} for name in per_class},
        "min_per_class": args.min_per_class,
        "low_count_classes": low,
        "skipped": {"unreadable": len(unreadable), "files": unreadable},
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Split and resize the raw crop-disease corpus.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW, help="Input, one dir per class.")
    parser.add_argument("--processed", type=Path, default=DEFAULT_PROCESSED, help="Output root.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="Manifest path.")
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help="Fixed so the split is reproducible; record it wherever a result is reported.",
    )
    parser.add_argument("--size", type=int, default=DEFAULT_SIZE, help="Output edge, in pixels.")
    parser.add_argument(
        "--resize-mode",
        choices=("cover", "pad", "stretch"),
        default="cover",
        help="cover: centre-crop to fill. pad: letterbox. stretch: distort.",
    )
    parser.add_argument("--train-ratio", type=float, default=DEFAULT_RATIOS[0])
    parser.add_argument("--val-ratio", type=float, default=DEFAULT_RATIOS[1])
    parser.add_argument("--test-ratio", type=float, default=DEFAULT_RATIOS[2])
    parser.add_argument(
        "--min-per-class",
        type=int,
        default=DEFAULT_MIN_PER_CLASS,
        help="Classes below this are flagged as a risk. Never fails the run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the tables and the warnings; write no images and no manifest.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace a previous run's output instead of refusing.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except PrepareError as exc:
        print(f"\nerror: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
