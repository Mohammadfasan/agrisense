"""Disease classification service.

The real implementation loads the artifact named by the registry and runs
inference. Until a trained model exists, this documents the contract the
routers will call.
"""

from __future__ import annotations

import io

from PIL import Image

from app.core.model_registry import load_active
from app.schemas.model import ModelType

# Input size the disease classifier is trained on.
INPUT_SIZE = (224, 224)


def preprocess(image_bytes: bytes) -> Image.Image:
    """Decode and normalise an uploaded photo to the model's input size."""
    image = Image.open(io.BytesIO(image_bytes))
    image = image.convert("RGB")
    return image.resize(INPUT_SIZE)


def active_version() -> str:
    """Version string of the disease model currently in service."""
    return load_active(ModelType.DISEASE).version
