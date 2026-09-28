"""Download model artifacts from the GitHub Release and verify SHA256.

ADR-00Y: model files are never in Git. config/inference.yaml (release:)
pins the URL and SHA256 of each file; this script is the only way they
reach a machine.

Behaviour:
  - file already present with the right hash -> skip (safe to run on every start)
  - download to <file>.part, hash while streaming, then atomic rename
  - wrong hash -> delete the partial file and exit 1 (never load a bad model)
  - HTTP 4xx (e.g. 404) -> stop at once; network errors and 5xx -> retry
  - the sidecar's recorded ONNX hash and version must match the config

Run from ml-service/:
    python scripts/fetch_model.py
    python scripts/fetch_model.py --dest artifacts/_fetch_test
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ML_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ML_ROOT / "config" / "inference.yaml"
DEFAULT_DEST = ML_ROOT / "artifacts"

CHUNK = 1 << 20  # 1 MiB
TIMEOUT_S = 30
RETRIES = 3


class FetchError(Exception):
    """A problem that must stop startup: bad hash, bad config, or no download."""


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def normalise_hash(value: str) -> str:
    """Accept certutil output (spaces, capitals) and check it is real SHA256."""
    h = str(value).strip().lower().replace(" ", "")
    if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
        raise FetchError(f"Not a valid SHA256 in config: {value!r}")
    return h


def wait_before_retry(attempt: int, exc: Exception) -> None:
    if attempt < RETRIES:
        wait = 2**attempt
        print(f"  attempt {attempt} failed ({exc}); retrying in {wait}s")
        time.sleep(wait)


def download(url: str, target: Path, expected: str) -> None:
    part = target.with_name(target.name + ".part")
    last_error: Exception | None = None

    for attempt in range(1, RETRIES + 1):
        try:
            digest = hashlib.sha256()
            req = urllib.request.Request(url, headers={"User-Agent": "agrisense-fetch-model"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp, part.open("wb") as out:
                for chunk in iter(lambda: resp.read(CHUNK), b""):
                    digest.update(chunk)
                    out.write(chunk)

            actual = digest.hexdigest()
            if actual != expected:
                part.unlink(missing_ok=True)
                raise FetchError(
                    f"SHA256 mismatch for {target.name}: expected {expected}, got {actual}"
                )
            part.replace(target)  # atomic: the target is either old or complete
            return

        except FetchError:
            raise  # a wrong hash will not fix itself - do not retry
        except urllib.error.HTTPError as exc:
            part.unlink(missing_ok=True)
            if 400 <= exc.code < 500:  # 404, 403 ... will not fix themselves
                raise FetchError(
                    f"HTTP {exc.code} for {url} - check that the release is "
                    "published, the tag and file name match, and the repo is public"
                ) from exc
            last_error = exc  # 5xx: server trouble, worth retrying
            wait_before_retry(attempt, exc)
        except OSError as exc:  # network errors, timeouts
            last_error = exc
            part.unlink(missing_ok=True)
            wait_before_retry(attempt, exc)

    raise FetchError(f"Download failed after {RETRIES} attempts: {url} ({last_error})")


def ensure_file(entry: dict, dest: Path) -> Path:
    target = dest / entry["file"]
    expected = normalise_hash(entry["sha256"])

    if target.exists():
        if sha256_of(target) == expected:
            print(f"  {target.name}: present, hash OK - skipped")
            return target
        print(f"  {target.name}: present but hash is WRONG - downloading again")

    print(f"  {target.name}: downloading ...")
    download(entry["url"], target, expected)
    print(f"  {target.name}: downloaded, hash OK ({target.stat().st_size / 1e6:.1f} MB)")
    return target


def fetch(dest: Path) -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    try:
        release = config["release"]
        onnx_entry, sidecar_entry = release["onnx"], release["sidecar"]
    except (KeyError, TypeError) as exc:
        raise FetchError(f"config/inference.yaml has no complete 'release' block ({exc})") from exc

    dest.mkdir(parents=True, exist_ok=True)
    print(f"Model v{release['version']} -> {dest}")
    ensure_file(onnx_entry, dest)
    sidecar_path = ensure_file(sidecar_entry, dest)

    # The two files must belong together.
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    if sidecar["onnx"]["sha256"] != normalise_hash(onnx_entry["sha256"]):
        raise FetchError("Sidecar describes a different ONNX file than the one pinned")
    if sidecar["model_version"] != str(release["version"]):
        raise FetchError(
            f"Version mismatch: config {release['version']}, " f"sidecar {sidecar['model_version']}"
        )
    print("OK")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    args = parser.parse_args()
    try:
        fetch(args.dest)
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
