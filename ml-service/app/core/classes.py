"""Load and validate the disease class list from config/classes.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

ML_ROOT = Path(__file__).resolve().parents[2]  # .../ml-service
CLASSES_FILE = ML_ROOT / "config" / "classes.yaml"
RAW_LAB_DIR = ML_ROOT / "data" / "raw"

VALID_SOURCES = {"plantvillage", "paddy_doctor"}


@dataclass(frozen=True)
class DiseaseClass:
    id: int
    key: str
    crop: str
    is_healthy: bool
    source: str
    display: dict[str, str]


@lru_cache(maxsize=1)
def load_classes() -> tuple[DiseaseClass, ...]:
    data = yaml.safe_load(CLASSES_FILE.read_text(encoding="utf-8"))
    classes = tuple(DiseaseClass(**c) for c in data["classes"])
    _validate(classes)
    return classes


def _validate(classes: tuple[DiseaseClass, ...]) -> None:
    ids = [c.id for c in classes]
    keys = [c.key for c in classes]

    if ids != list(range(len(classes))):
        raise ValueError(f"ids must be 0..{len(classes) - 1} in order, got {ids}")
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate class keys in classes.yaml")
    if keys != sorted(keys):
        raise ValueError("classes must be sorted alphabetically by key")
    for c in classes:
        if c.source not in VALID_SOURCES:
            raise ValueError(f"{c.key}: unknown source '{c.source}'")
        if not {"en", "ta", "si"} <= c.display.keys():
            raise ValueError(f"{c.key}: display needs en, ta and si")


def class_keys() -> list[str]:
    return [c.key for c in load_classes()]


def by_id(class_id: int) -> DiseaseClass:
    return load_classes()[class_id]


def by_key(key: str) -> DiseaseClass:
    for c in load_classes():
        if c.key == key:
            return c
    raise KeyError(key)


if __name__ == "__main__":
    # Check that the config matches the folders on disk.
    img_ext = {".jpg", ".jpeg", ".png"}
    total = 0
    problems = 0
    for c in load_classes():
        folder = RAW_LAB_DIR / c.key
        if not folder.is_dir():
            print(f"  MISSING FOLDER  {c.key}")
            problems += 1
            continue
        n = sum(1 for f in folder.iterdir() if f.suffix.lower() in img_ext)
        total += n
        print(f"{c.id:3d}  {n:6d}  {c.key:24s} {c.source}")

    extra = {p.name for p in RAW_LAB_DIR.iterdir() if p.is_dir()} - set(class_keys())
    for name in sorted(extra):
        print(f"  EXTRA FOLDER (not in yaml)  {name}")
        problems += 1

    print(f"\n{total} images, {len(load_classes())} classes, {problems} problems")
