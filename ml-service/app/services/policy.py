"""Decision policy: model logits -> diagnose, or escalate to an officer.

This must match training/policy_report.py `apply_policy` EXACTLY, because
that rule produced the Week 4 test numbers (20 errors reached farmers,
7 dangerous, 5.6% escalated). scripts/service_parity.py checks it.

    probs      = softmax(logits / T)
    pred       = argmax(probs),  confidence = max(probs)
    required   = max(base, healthy) if pred is a healthy class else base
    diagnosed  <=>  confidence >= required

Crop masking is NOT applied: on test it raised dangerous errors 7 -> 8.
It needs thresholds re-tuned on val first (see Week 4 findings).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.core.classes import load_classes
from app.core.inference_config import InferenceConfig

Status = Literal["diagnosed", "escalated"]


@dataclass(frozen=True)
class Candidate:
    class_key: str
    probability: float


@dataclass(frozen=True)
class Decision:
    """The outcome for one photo. `class_key` is the top guess even when escalated."""

    status: Status
    class_index: int
    class_key: str
    is_healthy: bool
    confidence: float
    required: float
    top: tuple[Candidate, ...]


def softmax_with_temperature(logits: np.ndarray, temperature: float) -> np.ndarray:
    """Calibrated probabilities along the last axis."""
    z = logits.astype(np.float64) / temperature
    z -= z.max(axis=-1, keepdims=True)  # subtract the max: avoids overflow, same result
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


@dataclass(frozen=True)
class DecisionPolicy:
    class_keys: tuple[str, ...]
    is_healthy: np.ndarray  # (C,) bool
    temperature: float
    base: float
    healthy: float

    @classmethod
    def from_config(cls, config: InferenceConfig) -> DecisionPolicy:
        classes = load_classes()
        return cls(
            class_keys=tuple(c.key for c in classes),
            is_healthy=np.array([bool(c.is_healthy) for c in classes]),
            temperature=config.calibration.temperature,
            base=config.thresholds.base,
            healthy=config.thresholds.healthy,
        )

    def evaluate(self, logits: np.ndarray) -> tuple[np.ndarray, ...]:
        """Vectorised rule for a (N, C) batch.

        Returns (probs, preds, confidence, required, diagnosed). Both the
        service (one photo) and the parity script (whole test set) use this,
        so there is only ONE implementation of the rule.
        """
        if logits.ndim != 2 or logits.shape[1] != len(self.class_keys):
            raise ValueError(f"expected logits (N, {len(self.class_keys)}), got {logits.shape}")
        probs = softmax_with_temperature(logits, self.temperature)
        preds = probs.argmax(axis=1)
        confidence = probs.max(axis=1)
        required = np.where(self.is_healthy[preds], max(self.base, self.healthy), self.base)
        diagnosed = confidence >= required
        return probs, preds, confidence, required, diagnosed

    def decide(self, logits_row: np.ndarray, top_k: int = 3) -> Decision:
        """Decision for one photo; `logits_row` has shape (C,)."""
        probs, preds, confidence, required, diagnosed = self.evaluate(logits_row[None, :])
        idx = int(preds[0])
        order = np.argsort(probs[0])[::-1][:top_k]
        return Decision(
            status="diagnosed" if bool(diagnosed[0]) else "escalated",
            class_index=idx,
            class_key=self.class_keys[idx],
            is_healthy=bool(self.is_healthy[idx]),
            confidence=float(confidence[0]),
            required=float(required[0]),
            top=tuple(Candidate(self.class_keys[i], float(probs[0, i])) for i in order),
        )
