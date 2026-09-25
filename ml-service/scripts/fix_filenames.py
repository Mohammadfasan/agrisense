"""Remove spaces before the file extension in data/raw (Kaggle rejects them)."""

from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

renamed = 0
for f in RAW.rglob("*"):
    if not f.is_file():
        continue
    clean_stem = f.stem.rstrip()
    if clean_stem == f.stem:
        continue
    new = f.with_name(clean_stem + f.suffix)
    if new.exists():
        raise SystemExit(f"Name clash, stopped: {new}")
    f.rename(new)
    renamed += 1
    print(f"renamed: {f.name!r} -> {new.name!r}")

print(f"total renamed: {renamed}")
