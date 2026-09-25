"""Grad-CAM: show which part of the leaf the model used for its decision."""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import yaml
from torch.utils.data import DataLoader
from torchvision import datasets

from app.core.classes import load_classes
from training.data import IMAGENET_MEAN, IMAGENET_STD, build_transforms
from training.model import build_model


class GradCAM:
    """Grad-CAM on one conv layer. Reusable in the FastAPI service (Week 5)."""

    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module) -> None:
        self.model = model
        self.activations: torch.Tensor | None = None
        self.gradients: torch.Tensor | None = None
        target_layer.register_forward_hook(self._save_activation)

    def _save_activation(self, _module, _inputs, output) -> None:
        self.activations = output  # (1, 1280, 7, 7)
        output.register_hook(self._save_gradient)

    def _save_gradient(self, grad: torch.Tensor) -> None:
        self.gradients = grad  # same shape as activations

    def __call__(self, image: torch.Tensor, class_idx: int | None = None):
        """image: (3, H, W) normalised. Returns (heatmap HxW in 0..1, logits, class_idx)."""
        self.model.eval()
        # requires_grad on the input makes gradients flow even through frozen layers
        x = image.unsqueeze(0).clone().requires_grad_(True)
        logits = self.model(x)
        if class_idx is None:
            class_idx = int(logits.argmax(dim=1))

        self.model.zero_grad()
        logits[0, class_idx].backward()

        # 1. How important is each of the 1280 feature maps? (average gradient)
        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        # 2. Weighted sum of the feature maps, keep only positive evidence
        cam = torch.relu((weights * self.activations).sum(dim=1, keepdim=True))
        # 3. Resize the 7x7 map up to the image size, scale to 0..1
        cam = torch.nn.functional.interpolate(
            cam, size=image.shape[1:], mode="bilinear", align_corners=False
        )[0, 0]
        cam = cam - cam.min()
        cam = cam / (cam.max() + 1e-8)
        return cam.detach().cpu().numpy(), logits.detach()[0], class_idx


def denormalize(image: torch.Tensor) -> np.ndarray:
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
    return (image * std + mean).clamp(0, 1).permute(1, 2, 0).numpy()


@torch.no_grad()
def predict_all(model, dataset, temperature: float, device) -> np.ndarray:
    model.eval()
    loader = DataLoader(dataset, batch_size=64, shuffle=False, num_workers=0)
    all_probs = []
    for images, _ in loader:
        logits = model(images.to(device)) / temperature
        all_probs.append(torch.softmax(logits, dim=1).cpu())
    return torch.cat(all_probs).numpy()


def draw_grid(dataset, indices, cam_engine, class_names, is_healthy, probs, out_path, title):
    cols = 4  # 4 examples per row, each = original + heatmap
    rows = (len(indices) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols * 2, figsize=(16, 4.2 * rows))
    axes = np.atleast_2d(axes)
    for ax in axes.flat:
        ax.axis("off")

    for k, idx in enumerate(indices):
        image, true_idx = dataset[idx]
        heatmap, _, pred_idx = cam_engine(image)
        conf = probs[idx, pred_idx]
        rgb = denormalize(image)
        dangerous = is_healthy[pred_idx] and not is_healthy[true_idx]

        r, c = divmod(k, cols)
        ax_img, ax_cam = axes[r, c * 2], axes[r, c * 2 + 1]
        ax_img.imshow(rgb)
        ax_img.set_title(f"true: {class_names[true_idx]}", fontsize=7)
        ax_cam.imshow(rgb)
        ax_cam.imshow(heatmap, cmap="jet", alpha=0.45)
        ax_cam.set_title(
            f"pred: {class_names[pred_idx]} ({conf:.2f})",
            fontsize=7,
            color="red" if dangerous else ("green" if pred_idx == true_idx else "black"),
        )

    fig.suptitle(title, fontsize=12)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/finetune_best.pt"))
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--inference-config", type=Path, default=Path("config/inference.yaml"))
    parser.add_argument("--out-dir", type=Path, default=Path("reports"))
    parser.add_argument("--n-errors", type=int, default=12)
    args = parser.parse_args()

    device = torch.device("cpu")  # Grad-CAM on a few images is fast enough on CPU
    cfg = yaml.safe_load(args.inference_config.read_text(encoding="utf-8"))
    temperature = float(cfg["calibration"]["temperature"])

    classes = load_classes()
    keys = [c.key for c in classes]
    is_healthy = [bool(c.is_healthy) for c in classes]

    ckpt = torch.load(args.checkpoint, map_location=device)
    if ckpt["class_names"] != keys:
        raise SystemExit("checkpoint class order does not match classes.yaml")
    model = build_model(num_classes=len(keys)).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    dataset = datasets.ImageFolder(args.data_root / "val", transform=build_transforms(train=False))
    if dataset.classes != keys:
        raise SystemExit("val folder order does not match classes.yaml")

    print("predicting all val images...")
    probs = predict_all(model, dataset, temperature, device)
    preds = probs.argmax(axis=1)
    labels = np.array(dataset.targets)

    # 12 correct: the most confident correct example of each class
    correct_idx = []
    for c in range(len(keys)):
        mask = np.where((labels == c) & (preds == c))[0]
        if len(mask):
            correct_idx.append(int(mask[np.argmax(probs[mask, c])]))

    # Mistakes: dangerous ones ("diseased -> healthy") first, then the rest
    wrong = np.where(preds != labels)[0]
    dangerous = [int(i) for i in wrong if is_healthy[preds[i]] and not is_healthy[labels[i]]]
    other = [int(i) for i in wrong if int(i) not in dangerous]
    error_idx = (dangerous + other)[: args.n_errors]
    print(f"{len(wrong)} mistakes in val, {len(dangerous)} dangerous")

    cam_engine = GradCAM(model, target_layer=model.features[-1])
    args.out_dir.mkdir(parents=True, exist_ok=True)
    draw_grid(
        dataset,
        correct_idx,
        cam_engine,
        keys,
        is_healthy,
        probs,
        args.out_dir / "gradcam_val_correct.png",
        "Grad-CAM: correct predictions (val)",
    )
    draw_grid(
        dataset,
        error_idx,
        cam_engine,
        keys,
        is_healthy,
        probs,
        args.out_dir / "gradcam_val_errors.png",
        "Grad-CAM: mistakes (val) - red = diseased predicted as healthy",
    )
    print(f"saved to {args.out_dir}/ (gradcam_val_correct.png, gradcam_val_errors.png)")


if __name__ == "__main__":
    main()
