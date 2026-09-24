"""Replace the 10 PlantVillage folders in data/raw with the full versions from zips."""

import shutil
import zipfile
from pathlib import Path

DOWNLOADS = Path(r"C:\Users\94768\Downloads")
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

EXPECTED = {
    "maize_common_rust": 1192,
    "maize_healthy": 1162,
    "pepper_bacterial_spot": 997,
    "pepper_healthy": 1478,
    "potato_early_blight": 1000,
    "potato_healthy": 152,
    "potato_late_blight": 1000,
    "tomato_early_blight": 1000,
    "tomato_healthy": 1591,
    "tomato_late_blight": 1909,
}

# 1. Check ALL zips exist before deleting anything
missing = [k for k in EXPECTED if not (DOWNLOADS / f"{k}.zip").exists()]
if missing:
    raise SystemExit(f"Missing zips, nothing changed: {missing}")

# 2. Replace each folder and check the count
for key, expected in EXPECTED.items():
    dst = RAW / key
    shutil.rmtree(dst, ignore_errors=True)
    with zipfile.ZipFile(DOWNLOADS / f"{key}.zip") as z:
        z.extractall(dst)
    got = len(list(dst.iterdir()))
    status = "OK" if got == expected else "MISMATCH"
    print(f"{key:<24} got={got:<5} expected={expected:<5} {status}")
