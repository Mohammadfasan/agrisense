"""Dataset loading, transforms and class weights for AgriSense training."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

# MobileNetV2 was pretrained on ImageNet with these exact values.
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
IMG_SIZE = 224


def build_transforms(train: bool) -> transforms.Compose:
    if train:
        return transforms.Compose(
            [
                transforms.RandomResizedCrop(IMG_SIZE, scale=(0.7, 1.0)),
                transforms.RandomHorizontalFlip(),
                transforms.RandomVerticalFlip(),
                transforms.RandomRotation(20),
                # No hue change: disease colour (yellow, brown spots) is a real signal.
                transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
            ]
        )
    return transforms.Compose(
        [
            transforms.CenterCrop(IMG_SIZE),  # images are already 256x256
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )


def check_class_order(ds: datasets.ImageFolder, expected_keys: list[str], split: str) -> None:
    """Fail fast if folder order does not match classes.yaml ids."""
    if ds.classes != expected_keys:
        raise ValueError(
            f"[{split}] class order mismatch.\n"
            f"  folders : {ds.classes}\n"
            f"  yaml    : {expected_keys}"
        )


def compute_class_weights(ds: datasets.ImageFolder) -> torch.Tensor:
    """Inverse-frequency weights: w_c = N / (K * n_c)."""
    counts = Counter(ds.targets)
    n, k = len(ds.targets), len(ds.classes)
    weights = [n / (k * counts[i]) for i in range(k)]
    return torch.tensor(weights, dtype=torch.float32)


@dataclass
class Loaders:
    train: DataLoader
    val: DataLoader
    test: DataLoader
    class_names: list[str]
    class_weights: torch.Tensor


def build_loaders(
    data_root: Path,
    expected_keys: list[str],
    batch_size: int = 32,
    num_workers: int = 2,
    seed: int = 42,
) -> Loaders:
    splits = {}
    for split in ("train", "val", "test"):
        ds = datasets.ImageFolder(data_root / split, transform=build_transforms(split == "train"))
        check_class_order(ds, expected_keys, split)
        splits[split] = ds

    g = torch.Generator().manual_seed(seed)
    common = {
        "batch_size": batch_size,
        "num_workers": num_workers,
        "pin_memory": torch.cuda.is_available(),
    }
    return Loaders(
        train=DataLoader(splits["train"], shuffle=True, generator=g, **common),
        val=DataLoader(splits["val"], shuffle=False, **common),
        test=DataLoader(splits["test"], shuffle=False, **common),
        class_names=splits["train"].classes,
        class_weights=compute_class_weights(splits["train"]),
    )


if __name__ == "__main__":
    import argparse

    from app.core.classes import load_classes  # rename to match your loader

    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    args = parser.parse_args()

    keys = [c.key for c in load_classes()]
    loaders = build_loaders(args.data_root, keys)

    print(
        f"train={len(loaders.train.dataset)}  val={len(loaders.val.dataset)}  "
        f"test={len(loaders.test.dataset)}"
    )
    for name, w in zip(loaders.class_names, loaders.class_weights, strict=False):
        print(f"  {name:<28} weight={w:.2f}")

    images, labels = next(iter(loaders.train))
    print("batch:", tuple(images.shape), "labels:", labels[:8].tolist())
