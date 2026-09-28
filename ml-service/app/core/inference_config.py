"""Typed, validated view of config/inference.yaml.

Loaded once at startup. A bad value (a threshold of 7, "healthy" below
"base", a malformed hash) stops the service before it serves a single
request - the same fail-fast idea as the Zod env config on the Node side.

The `model:` block in the YAML belongs to the training scripts and is
ignored here.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import SERVICE_ROOT

INFERENCE_CONFIG_PATH = SERVICE_ROOT / "config" / "inference.yaml"


class _Strict(BaseModel):
    """Unknown keys are errors (catches typos like `helthy`); values are read-only."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class Calibration(_Strict):
    temperature: float = Field(gt=0)


class Thresholds(_Strict):
    base: float = Field(gt=0, lt=1)
    healthy: float = Field(gt=0, lt=1)

    @model_validator(mode="after")
    def _healthy_needs_more_confidence(self) -> Thresholds:
        # ADR: a missed disease is the costliest error, so "healthy" must
        # never be easier to reach than any other answer.
        if self.healthy < self.base:
            raise ValueError("thresholds.healthy must be >= thresholds.base")
        return self


class ReleaseFile(_Strict):
    file: str = Field(min_length=1)
    url: str = Field(pattern=r"^https://")
    sha256: str

    @field_validator("sha256")
    @classmethod
    def _valid_sha256(cls, value: str) -> str:
        h = value.strip().lower().replace(" ", "")
        if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
            raise ValueError("must be a 64-character SHA256 hex string")
        return h


class Release(_Strict):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    onnx: ReleaseFile
    sidecar: ReleaseFile


class InferenceConfig(BaseModel):
    # extra="ignore" only at the top level, so the training `model:` block is allowed.
    model_config = ConfigDict(extra="ignore", frozen=True)

    calibration: Calibration
    thresholds: Thresholds
    release: Release


def load_inference_config(path: Path = INFERENCE_CONFIG_PATH) -> InferenceConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return InferenceConfig.model_validate(raw)


@lru_cache
def get_inference_config() -> InferenceConfig:
    """Cached: the YAML is read and validated once per process."""
    return load_inference_config()
