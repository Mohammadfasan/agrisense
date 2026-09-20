"""Look at the raw corpus before splitting it.

Answers the four questions worth asking of a downloaded image set:

* **What is the class balance?** A bar chart to ``reports/class_distribution.png``
  and the same numbers as a table.
* **How big are the images?** Mean and median dimensions, so the 224x224 target
  in ``prepare_dataset.py`` can be checked against what is actually there.
* **Is anything corrupt?** Named, so it can be removed before it is discovered
  mid-run.
* **Is anything duplicated?** By SHA-256 of the file bytes. Duplicates are the
  finding that most often changes what a result means -- see below.

Reads only. Nothing here downloads, moves, deletes or trains.

Usage::

    python scripts/inspect_dataset.py
    python scripts/inspect_dataset.py --dir data/processed/train
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

from PIL import Image, UnidentifiedImageError

SERVICE_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_DIR = SERVICE_ROOT / "data" / "raw"
DEFAULT_REPORTS = SERVICE_ROOT / "reports"
CHART_NAME = "class_distribution.png"
REPORT_NAME = "inspection.json"

IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})
HASH_CHUNK = 1 << 20


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


class InspectError(RuntimeError):
    """A run could not proceed. Reported to the operator, not a traceback."""


# --------------------------------------------------------------------------- #
# Walking                                                                       #
# --------------------------------------------------------------------------- #


def discover(root: Path) -> OrderedDict[str, list[Path]]:
    """Class directories under ``root``, each with its image files, sorted."""
    if not root.is_dir():
        raise InspectError(
            f"No directory at {root}\nExpected <root>/<class_name>/*.jpg -- see data/README.md."
        )

    classes: OrderedDict[str, list[Path]] = OrderedDict()
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        classes[entry.name] = sorted(
            (f for f in entry.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_SUFFIXES),
            key=lambda p: p.name,
        )

    if not classes:
        raise InspectError(f"{root} has no class directories in it.")
    return classes


def file_digest(path: Path) -> str:
    """SHA-256 of the file's bytes, read in chunks.

    Of the *bytes*, not of the decoded pixels. That makes this exact-duplicate
    detection and nothing more: the same photo saved twice at different JPEG
    qualities has two different digests and will not be found here. Perceptual
    hashing catches those and needs a dependency this scaffold does not have --
    worth adding if the corpus turns out to be scraped rather than published.
    """
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------- #
# Scanning                                                                      #
# --------------------------------------------------------------------------- #


def scan(classes: OrderedDict[str, list[Path]], root: Path) -> dict:
    """One pass over every file: size, dimensions, readability, digest."""
    widths: list[int] = []
    heights: list[int] = []
    file_sizes: list[int] = []
    corrupt: list[dict[str, str]] = []
    by_digest: dict[str, list[str]] = defaultdict(list)
    modes: dict[str, int] = defaultdict(int)
    per_class: OrderedDict[str, int] = OrderedDict()

    total = sum(len(files) for files in classes.values())
    seen = 0

    for name, files in classes.items():
        per_class[name] = len(files)
        for path in files:
            seen += 1
            if seen % 500 == 0:
                print(f"  ...{seen}/{total}", file=sys.stderr)

            relative = str(path.relative_to(root))
            try:
                # `verify()` catches truncation without decoding the whole
                # image, but it leaves the file unusable, so the handle is
                # reopened to read the parts that need a live image.
                with Image.open(path) as probe:
                    probe.verify()
                with Image.open(path) as image:
                    width, height = image.size
                    modes[image.mode] += 1
                    # Forces a full decode. A file can pass `verify()` and
                    # still fail here, which is exactly the file that would
                    # otherwise fail in the middle of a training run.
                    image.load()
            except (OSError, UnidentifiedImageError, SyntaxError) as exc:
                corrupt.append({"file": relative, "error": str(exc)})
                continue

            widths.append(width)
            heights.append(height)
            file_sizes.append(path.stat().st_size)
            by_digest[file_digest(path)].append(relative)

    duplicates = {digest: paths for digest, paths in by_digest.items() if len(paths) > 1}

    return {
        "per_class": per_class,
        "widths": widths,
        "heights": heights,
        "file_sizes": file_sizes,
        "modes": dict(sorted(modes.items())),
        "corrupt": corrupt,
        "duplicates": duplicates,
    }


def summarise_sizes(widths: list[int], heights: list[int], file_sizes: list[int]) -> dict:
    """Mean and median for both edges, plus the extremes.

    The median is reported next to the mean deliberately: a corpus assembled
    from two sources is usually bimodal, and a mean sitting between two clusters
    describes no image in the set.
    """
    if not widths:
        return {}

    return {
        "count": len(widths),
        "width": {
            "mean": round(statistics.fmean(widths), 1),
            "median": statistics.median(widths),
            "min": min(widths),
            "max": max(widths),
        },
        "height": {
            "mean": round(statistics.fmean(heights), 1),
            "median": statistics.median(heights),
            "min": min(heights),
            "max": max(heights),
        },
        "file_size_kb": {
            "mean": round(statistics.fmean(file_sizes) / 1024, 1),
            "median": round(statistics.median(file_sizes) / 1024, 1),
        },
    }


# --------------------------------------------------------------------------- #
# Output                                                                        #
# --------------------------------------------------------------------------- #


def print_distribution(per_class: OrderedDict[str, int]) -> None:
    width = max((len(name) for name in per_class), default=5)
    total = sum(per_class.values())
    largest = max(per_class.values(), default=0)

    print("\nClass distribution")
    print(f"  {'class'.ljust(width)}  {'images':>7}  {'share':>7}")
    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}")
    for name, count in per_class.items():
        share = (count / total * 100) if total else 0.0
        print(f"  {name.ljust(width)}  {count:>7}  {share:>6.1f}%")
    print(f"  {'-' * width}  {'-' * 7}  {'-' * 7}")
    print(f"  {'total'.ljust(width)}  {total:>7}")

    smallest = min(per_class.values(), default=0)
    if smallest:
        ratio = largest / smallest
        print(f"\n  Imbalance ratio (largest:smallest): {ratio:.1f}:1")
        if ratio >= 10:
            print(
                "  Above 10:1 a model can score well by answering with the majority\n"
                "  class alone. Report per-class recall, not overall accuracy."
            )


def print_sizes(sizes: dict) -> None:
    if not sizes:
        print("\nNo readable images to measure.")
        return

    print("\nImage size")
    print(
        f"  width   mean {sizes['width']['mean']:>8}  median {sizes['width']['median']:>6}"
        f"  range {sizes['width']['min']}-{sizes['width']['max']}"
    )
    print(
        f"  height  mean {sizes['height']['mean']:>8}  median {sizes['height']['median']:>6}"
        f"  range {sizes['height']['min']}-{sizes['height']['max']}"
    )
    print(
        f"  file    mean {sizes['file_size_kb']['mean']:>8} KB"
        f"  median {sizes['file_size_kb']['median']:>6} KB"
    )


def print_findings(corrupt: list[dict[str, str]], duplicates: dict[str, list[str]]) -> None:
    if corrupt:
        print(f"\nCORRUPT: {len(corrupt)} file(s) could not be decoded:")
        for item in corrupt[:20]:
            print(f"  - {item['file']}: {item['error']}")
        if len(corrupt) > 20:
            print(f"  ... and {len(corrupt) - 20} more (full list in the JSON report)")
        print("  prepare_dataset.py skips these; removing them keeps the counts honest.")
    else:
        print("\nNo corrupt files.")

    if not duplicates:
        print("No exact duplicates.")
        return

    copies = sum(len(paths) - 1 for paths in duplicates.values())
    cross = {
        digest: paths
        for digest, paths in duplicates.items()
        if len({Path(p).parts[0] for p in paths}) > 1
    }

    groups = "group" if len(duplicates) == 1 else "groups"
    plural = "y" if copies == 1 else "ies"
    print(
        f"\nDUPLICATES: {len(duplicates)} {groups} of byte-identical files "
        f"({copies} redundant cop{plural})."
    )
    for paths in list(duplicates.values())[:10]:
        print(f"  - {' == '.join(paths)}")
    if len(duplicates) > 10:
        print(f"  ... and {len(duplicates) - 10} more (full list in the JSON report)")

    print(
        "  Within a class, a duplicate inflates the count and can land on both\n"
        "  sides of the split -- the model is then tested on an image it trained on."
    )
    if cross:
        spans = "spans" if len(cross) == 1 else "span"
        print(
            f"\n  {len(cross)} of these groups {spans} MORE THAN ONE class. That is a\n"
            "  labelling conflict, not a duplicate: the same bytes carry two answers,\n"
            "  and no model can get both right. Resolve these before splitting."
        )
        for paths in list(cross.values())[:10]:
            print(f"    - {' == '.join(paths)}")


def write_chart(per_class: OrderedDict[str, int], path: Path) -> bool:
    """Bar chart of the class counts. Returns False if matplotlib is absent.

    Imported here rather than at module scope so the rest of the inspection --
    corrupt files, duplicates, sizes, all of which need nothing but Pillow --
    still runs in an environment that has no plotting stack.
    """
    try:
        import matplotlib

        # Chosen before pyplot is imported. These scripts run over SSH and in
        # CI, where there is no display and the default backend fails on import.
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False

    names = list(per_class)
    counts = [per_class[name] for name in names]

    figure, axes = plt.subplots(figsize=(max(6.0, len(names) * 0.8), 5.0))
    bars = axes.bar(names, counts, color="#2f7d32")

    axes.set_ylabel("images")
    axes.set_title("Class distribution")
    axes.spines[["top", "right"]].set_visible(False)
    # Class names are long and snake_cased; horizontal labels overlap from
    # about five classes on.
    axes.set_xticks(range(len(names)))
    axes.set_xticklabels(names, rotation=45, ha="right")

    # The count on the bar, because reading a value off an axis is a thing
    # nobody does accurately and this chart goes into a thesis.
    axes.bar_label(bars, padding=2, fontsize=8)

    if counts:
        mean = sum(counts) / len(counts)
        axes.axhline(mean, color="#666", linewidth=1, linestyle="--")
        axes.text(
            len(names) - 0.4,
            mean,
            f" mean {mean:.0f}",
            va="bottom",
            ha="right",
            fontsize=8,
            color="#666",
        )

    figure.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=150)
    plt.close(figure)
    return True


# --------------------------------------------------------------------------- #
# The run                                                                       #
# --------------------------------------------------------------------------- #


def run(args: argparse.Namespace) -> int:
    classes = discover(args.dir)
    print(f"Scanning {args.dir} ({len(classes)} classes)...", file=sys.stderr)

    result = scan(classes, args.dir)
    sizes = summarise_sizes(result["widths"], result["heights"], result["file_sizes"])

    print_distribution(result["per_class"])
    print_sizes(sizes)
    if result["modes"]:
        print(f"\n  Colour modes: {result['modes']}")
    print_findings(result["corrupt"], result["duplicates"])

    chart_path = args.reports / CHART_NAME
    if write_chart(result["per_class"], chart_path):
        print(f"\nWrote {display_path(chart_path)}")
    else:
        print(
            "\nSkipped the chart: matplotlib is not installed.\n"
            "  .venv/Scripts/python -m pip install -r requirements-dev.txt",
            file=sys.stderr,
        )

    report = {
        "source": display_path(args.dir),
        "classes": len(classes),
        "per_class": dict(result["per_class"]),
        "total_images": sum(result["per_class"].values()),
        "sizes": sizes,
        "colour_modes": result["modes"],
        "corrupt": result["corrupt"],
        "duplicate_groups": [
            {"sha256": digest, "files": paths} for digest, paths in result["duplicates"].items()
        ],
    }
    report_path = args.reports / REPORT_NAME
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {display_path(report_path)}")

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect an image corpus laid out as <root>/<class_name>/*.jpg.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_DIR,
        help="Root to inspect. Point it at data/processed/train to check a split.",
    )
    parser.add_argument("--reports", type=Path, default=DEFAULT_REPORTS, help="Where output goes.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except InspectError as exc:
        print(f"\nerror: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
