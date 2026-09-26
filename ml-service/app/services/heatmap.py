"""Class heatmap from the model's in-graph CAM output.

cams[c] is a raw 7x7 map for class c (ADR: equals Grad-CAM on features[-1]).
For the predicted class we apply ReLU (keep only evidence FOR the class)
and scale to 0..1.

The service returns the small grid, not an image: 49 numbers are a few
hundred bytes, fit the offline scan history, and the client draws the
overlay (Day 23).

Where the grid sits on the farmer's photo: the model saw the photo
stretched to 256x256 and centre-cropped to 224, i.e. the middle 224/256 of
each axis. Stretching keeps relative positions, so on the ORIGINAL
(upright) photo the grid covers [left, top, right, bottom] =
[0.0625, 0.0625, 0.9375, 0.9375] for any aspect ratio.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.services.preprocess import InputSpec


@dataclass(frozen=True)
class Heatmap:
    grid: tuple[tuple[float, ...], ...]  # rows x cols, values 0..1
    region: tuple[float, float, float, float]  # left, top, right, bottom as fractions of the photo


def crop_region(spec: InputSpec) -> tuple[float, float, float, float]:
    """The part of the original photo the model actually saw, as fractions."""
    left = (spec.resize_to - spec.center_crop) // 2
    start = left / spec.resize_to
    end = (left + spec.center_crop) / spec.resize_to
    return (start, start, end, end)


def build_heatmap(cam: np.ndarray, spec: InputSpec, decimals: int = 3) -> Heatmap | None:
    """`cam` is the raw (h, w) map for ONE class. None when nothing is positive."""
    if cam.ndim != 2:
        raise ValueError(f"expected a 2-D map, got shape {cam.shape}")

    positive = np.maximum(cam.astype(np.float64), 0.0)  # ReLU: evidence FOR the class
    peak = float(positive.max())
    if peak <= 0.0:
        return None  # no region supports this class - nothing honest to show

    normalised = np.round(positive / peak, decimals)
    return Heatmap(
        grid=tuple(tuple(float(v) for v in row) for row in normalised),
        region=crop_region(spec),
    )
