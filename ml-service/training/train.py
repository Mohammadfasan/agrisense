"""Train MobileNetV2 for AgriSense.

Stage 1 (baseline): frozen backbone, train only the new 12-class head.
Stage 2 (fine-tune): start from the baseline, unfreeze the last N backbone blocks.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import f1_score
from torch import nn

from app.core.classes import load_classes
from training.data import IMAGENET_MEAN, IMAGENET_STD, IMG_SIZE, build_loaders
from training.model import (
    build_model,
    count_params,
    keep_frozen_bn_in_eval,
    unfreeze_last_blocks,
)


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def train_one_epoch(model, loader, criterion, optimizer, device, limit=None):
    model.train()
    keep_frozen_bn_in_eval(model)
    total_loss, correct, seen = 0.0, 0, 0
    for i, (images, labels) in enumerate(loader):
        if limit is not None and i >= limit:
            break
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()  # 1. clear old gradients
        logits = model(images)  # 2. forward pass
        loss = criterion(logits, labels)  # 3. measure the error
        loss.backward()  # 4. compute gradients
        optimizer.step()  # 5. update the weights

        total_loss += loss.item() * labels.size(0)
        correct += (logits.argmax(1) == labels).sum().item()
        seen += labels.size(0)
    return total_loss / seen, correct / seen


@torch.no_grad()
def evaluate(model, loader, criterion, device, limit=None):
    model.eval()
    total_loss, seen = 0.0, 0
    all_preds, all_labels = [], []
    for i, (images, labels) in enumerate(loader):
        if limit is not None and i >= limit:
            break
        images, labels = images.to(device), labels.to(device)
        logits = model(images)
        total_loss += criterion(logits, labels).item() * labels.size(0)
        seen += labels.size(0)
        all_preds.append(logits.argmax(1).cpu())
        all_labels.append(labels.cpu())

    preds = torch.cat(all_preds).numpy()
    y = torch.cat(all_labels).numpy()
    acc = float((preds == y).mean())
    macro_f1 = float(f1_score(y, preds, average="macro", zero_division=0))
    return total_loss / seen, acc, macro_f1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data/processed"))
    parser.add_argument("--out-dir", type=Path, default=Path("artifacts"))
    parser.add_argument("--run-name", default="baseline")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--lr", type=float, default=1e-3, help="LR for the head")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit-batches", type=int, default=None, help="smoke test only")
    # Fine-tuning options
    parser.add_argument(
        "--init-checkpoint",
        type=Path,
        default=None,
        help="start from these weights (e.g. the baseline)",
    )
    parser.add_argument(
        "--unfreeze-blocks",
        type=int,
        default=0,
        help="0 = frozen backbone; N = also train the last N backbone blocks",
    )
    parser.add_argument(
        "--backbone-lr",
        type=float,
        default=None,
        help="LR for unfrozen backbone blocks (default: lr / 10)",
    )
    args = parser.parse_args()

    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device}")

    keys = [c.key for c in load_classes()]
    loaders = build_loaders(args.data_root, keys, args.batch_size, args.num_workers, args.seed)

    # Build the model, optionally load baseline weights, optionally unfreeze blocks
    model = build_model(num_classes=len(keys))
    if args.init_checkpoint is not None:
        ckpt = torch.load(args.init_checkpoint, map_location="cpu")
        if ckpt["class_names"] != keys:
            raise SystemExit("init checkpoint class order does not match classes.yaml")
        model.load_state_dict(ckpt["model_state"])
        print(
            f"initialised from {args.init_checkpoint} " f"(val macro-F1 {ckpt['val_macro_f1']:.3f})"
        )
    if args.unfreeze_blocks > 0:
        unfreeze_last_blocks(model, args.unfreeze_blocks)
    model = model.to(device)

    total, trainable = count_params(model)
    print(f"params: {trainable:,} trainable / {total:,} total")

    criterion = nn.CrossEntropyLoss(weight=loaders.class_weights.to(device))

    # Two learning rates: normal for the head, smaller for the backbone
    backbone_lr = args.backbone_lr if args.backbone_lr is not None else args.lr / 10
    head_params = [p for p in model.classifier.parameters() if p.requires_grad]
    backbone_params = [p for p in model.features.parameters() if p.requires_grad]
    param_groups = [{"params": head_params, "lr": args.lr}]
    if backbone_params:
        param_groups.append({"params": backbone_params, "lr": backbone_lr})
    optimizer = torch.optim.AdamW(param_groups, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    stage = "frozen_head" if args.unfreeze_blocks == 0 else f"finetune_last{args.unfreeze_blocks}"
    args.out_dir.mkdir(parents=True, exist_ok=True)
    best_path = args.out_dir / f"{args.run_name}_best.pt"
    history, best_f1, bad_epochs = [], -1.0, 0

    for epoch in range(1, args.epochs + 1):
        t0 = time.time()
        tr_loss, tr_acc = train_one_epoch(
            model, loaders.train, criterion, optimizer, device, args.limit_batches
        )
        va_loss, va_acc, va_f1 = evaluate(model, loaders.val, criterion, device, args.limit_batches)
        scheduler.step()

        history.append(
            {
                "epoch": epoch,
                "train_loss": tr_loss,
                "train_acc": tr_acc,
                "val_loss": va_loss,
                "val_acc": va_acc,
                "val_macro_f1": va_f1,
            }
        )
        print(
            f"epoch {epoch:02d} | train loss {tr_loss:.4f} acc {tr_acc:.3f} | "
            f"val loss {va_loss:.4f} acc {va_acc:.3f} macroF1 {va_f1:.3f} | "
            f"{time.time() - t0:.0f}s"
        )

        if va_f1 > best_f1:
            best_f1, bad_epochs = va_f1, 0
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "class_names": loaders.class_names,
                    "arch": "mobilenet_v2",
                    "stage": stage,
                    "img_size": IMG_SIZE,
                    "mean": IMAGENET_MEAN,
                    "std": IMAGENET_STD,
                    "epoch": epoch,
                    "val_macro_f1": va_f1,
                    "lr": args.lr,
                    "backbone_lr": backbone_lr,
                },
                best_path,
            )
            print(f"  -> new best, saved to {best_path}")
        else:
            bad_epochs += 1
            if bad_epochs >= args.patience:
                print(f"early stop: no improvement for {args.patience} epochs")
                break

    history_path = args.out_dir / f"{args.run_name}_history.json"
    history_path.write_text(json.dumps(history, indent=2))
    print(f"best val macro-F1: {best_f1:.3f}")


if __name__ == "__main__":
    main()
