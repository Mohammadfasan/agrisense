"""Export wrapper: one forward pass returns both logits and class heatmaps.

Why this works
--------------
The fine-tuned MobileNetV2 ends with:

    features -> global average pool -> Dropout -> Linear(1280, 12)

At inference Dropout is the identity, so

    logits = W @ mean(features) + b

Averaging and multiplying by W are both linear, so their order can be
swapped:

    logits = mean(W @ features) + b

`W @ features` applied at every pixel is a 1x1 convolution. Its output has
one 7x7 map per class, and that map is the CAM heatmap. Because the head is
GAP + a single linear layer, CAM is identical to Grad-CAM on features[-1]
(see ADR in docs/architecture.md).

Temperature scaling is NOT applied here. It lives in config/inference.yaml
so it can be re-tuned without re-exporting the model.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn


class LogitsAndCams(nn.Module):
    """Wraps the trained model for ONNX export.

    Outputs:
        logits: (N, num_classes)       - same values as the original model
        cams:   (N, num_classes, h, w) - raw heatmaps, before ReLU/normalising
    """

    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        linear = model.classifier[-1]
        if not isinstance(linear, nn.Linear):
            raise TypeError(
                "Expected classifier[-1] to be nn.Linear. The CAM shortcut is only "
                "valid for a GAP + single linear head - revisit the ADR."
            )

        self.features = model.features
        # Linear weight (C, 1280) -> 1x1 conv weight (C, 1280, 1, 1).
        # Buffers, not Parameters: they are fixed values, not trainable,
        # and they are saved inside the ONNX file.
        self.register_buffer("cam_weight", linear.weight.detach().clone()[:, :, None, None])
        self.register_buffer("cam_bias", linear.bias.detach().clone())

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        feats = self.features(x)  # (N, 1280, 7, 7)
        cams = F.conv2d(feats, self.cam_weight)  # (N, 12, 7, 7)
        logits = cams.mean(dim=(2, 3)) + self.cam_bias  # (N, 12)
        return logits, cams


@torch.no_grad()
def check_same_logits(
    model: nn.Module, wrapper: LogitsAndCams, x: torch.Tensor, atol: float = 1e-4
) -> float:
    """Fail loudly if the wrapper's logits differ from the original model's.

    Returns the max absolute difference, so the caller can log it.
    """
    model.eval()
    wrapper.eval()
    original = model(x)
    wrapped, _cams = wrapper(x)
    diff = (original - wrapped).abs().max().item()
    if diff > atol:
        raise AssertionError(f"Wrapper logits differ from model: max diff {diff:.2e}")
    return diff
