"""MobileNetV2 transfer-learning model for AgriSense."""

from __future__ import annotations

import torch
from torch import nn
from torchvision import models


def build_model(num_classes: int, freeze_backbone: bool = True, dropout: float = 0.2) -> nn.Module:
    weights = models.MobileNet_V2_Weights.IMAGENET1K_V1
    model = models.mobilenet_v2(weights=weights)

    if freeze_backbone:
        for p in model.features.parameters():
            p.requires_grad = False

    # Replace the 1000-class ImageNet head with our 12-class head.
    in_features = model.classifier[1].in_features  # 1280
    model.classifier = nn.Sequential(
        nn.Dropout(dropout),
        nn.Linear(in_features, num_classes),
    )
    return model


def keep_frozen_bn_in_eval(model: nn.Module) -> None:
    """Call this right after model.train().

    Frozen layers should not update BatchNorm running statistics,
    otherwise the pretrained features slowly drift.
    """
    for m in model.features.modules():
        if isinstance(m, nn.BatchNorm2d) and not any(p.requires_grad for p in m.parameters()):
            m.eval()


def unfreeze_last_blocks(model: nn.Module, n_blocks: int) -> None:
    """For later fine-tuning: unfreeze the last n blocks of the backbone."""
    for block in list(model.features.children())[-n_blocks:]:
        for p in block.parameters():
            p.requires_grad = True


def count_params(model: nn.Module) -> tuple[int, int]:
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return total, trainable


if __name__ == "__main__":
    model = build_model(num_classes=12)
    total, trainable = count_params(model)
    print(f"total params     : {total:,}")
    print(f"trainable params : {trainable:,}")

    model.train()
    keep_frozen_bn_in_eval(model)

    x = torch.randn(4, 3, 224, 224)  # fake batch of 4 images
    logits = model(x)
    print("output shape:", tuple(logits.shape))  # expect (4, 12)
