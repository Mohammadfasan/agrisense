"""Turn uploaded image bytes into the model's input tensor.

The recipe is the one the model was trained and evaluated on. It is read
from the sidecar (written by training/export_onnx.py), and
training/cam_parity.py proves the result is bit-identical to the Week 4
torchvision val transform:

    bytes -> decode -> EXIF orientation -> RGB
          -> resize 256x256 bicubic (aspect NOT kept) -> center crop 224
          -> /255 -> (x - mean) / std -> (1, 3, 224, 224) float32

Uploads come from outside, so they are checked BEFORE the expensive decode:
format, pixel count (decompression bombs) and minimum size.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
MIN_SIDE_PX = 64
MAX_PIXELS = 50_000_000  # ~50 MP: above any phone camera, stops decompression bombs


class InvalidImageError(ValueError):
    """The upload is not a usable photo. The message is safe to return to the caller."""


@dataclass(frozen=True)
class InputSpec:
    """The preprocessing recipe, validated once when the model loads."""

    resize_to: int
    center_crop: int
    mean: tuple[float, ...]
    std: tuple[float, ...]

    @classmethod
    def from_sidecar(cls, input_block: dict[str, Any]) -> InputSpec:
        if input_block.get("resample") != "bicubic" or input_block.get("keep_aspect_ratio"):
            raise ValueError(f"Unsupported preprocessing in sidecar: {input_block}")
        spec = cls(
            resize_to=int(input_block["resize_to"]),
            center_crop=int(input_block["center_crop"]),
            mean=tuple(float(v) for v in input_block["mean"]),
            std=tuple(float(v) for v in input_block["std"]),
        )
        if not 0 < spec.center_crop <= spec.resize_to:
            raise ValueError("center_crop must be between 1 and resize_to")
        if len(spec.mean) != 3 or len(spec.std) != 3 or min(spec.std) <= 0:
            raise ValueError("mean and std need 3 values each; std must be > 0")
        return spec


def decode(data: bytes) -> Image.Image:
    """Open and fully decode an upload, or raise InvalidImageError with a clear reason."""
    if not data:
        raise InvalidImageError("the file is empty")

    try:
        # Image.open only reads the header here - cheap, even for a huge file.
        im = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("not a supported image (use JPEG, PNG or WebP)") from exc

    if im.format not in ALLOWED_FORMATS:
        raise InvalidImageError(f"unsupported format {im.format}; use JPEG, PNG or WebP")

    width, height = im.size
    if width * height > MAX_PIXELS:
        raise InvalidImageError(f"the image is too large ({width}x{height})")
    if min(width, height) < MIN_SIDE_PX:
        raise InvalidImageError(
            f"the image is too small ({width}x{height}); minimum {MIN_SIDE_PX}px per side"
        )

    try:
        im.load()  # full decode now, so a truncated or damaged file fails here
    except (OSError, Image.DecompressionBombError) as exc:
        raise InvalidImageError("the image data is damaged or incomplete") from exc
    return im


def to_model_input(im: Image.Image, spec: InputSpec) -> np.ndarray:
    """Apply the training recipe. Returns a (1, 3, H, W) float32 batch."""
    # Phones often store photos sideways plus an "rotate me" EXIF tag.
    im = ImageOps.exif_transpose(im).convert("RGB")

    size, crop = spec.resize_to, spec.center_crop
    left = (size - crop) // 2  # same offset as torchvision CenterCrop for 256 -> 224
    im = im.resize((size, size), Image.Resampling.BICUBIC)
    im = im.crop((left, left, left + crop, left + crop))

    arr = np.asarray(im, dtype=np.float32) / 255.0
    arr = (arr - np.asarray(spec.mean, dtype=np.float32)) / np.asarray(spec.std, dtype=np.float32)
    return np.ascontiguousarray(arr.transpose(2, 0, 1)[None])  # HWC -> NCHW


def preprocess(data: bytes, spec: InputSpec) -> np.ndarray:
    """Upload bytes -> model input. Raises InvalidImageError for unusable uploads."""
    return to_model_input(decode(data), spec)
