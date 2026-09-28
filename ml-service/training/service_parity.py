from __future__ import annotations

import json
import sys

import numpy as np

from app.core.config import SERVICE_ROOT, get_settings
from app.core.inference_config import get_inference_config
from app.services.disease_model import load_model_state

TEST_DIR = SERVICE_ROOT / "data" / "processed" / "test"
WEEK4_REPORT = SERVICE_ROOT / "reports" / "policy_test.json"
OUT_PATH = SERVICE_ROOT / "reports" / "service_parity_test.json"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
BORDERLINE = 1e-3  # confidence this close to a threshold could flip on float noise

# From the Week 4 devlog; used only if reports/policy_test.json is missing
# (for example when the policy report was produced on Kaggle).
WEEK4_FALLBACK = {"errors_passed": 20, "dangerous_passed": 7, "escalated": 0.056}


def load_expected(n: int) -> dict:
    if WEEK4_REPORT.is_file():
        rows = json.loads(WEEK4_REPORT.read_text(encoding="utf-8"))["rows"]
        row = next(r for r in rows if r["policy"].startswith("new:"))
        return {
            "source": WEEK4_REPORT.name,
            "exact": True,
            "errors_passed": row["errors_passed"],
            "dangerous_passed": row["dangerous_passed"],
            "escalated_count": round(row["escalated"] * n),
        }
    return {
        "source": "devlog fallback (rounded rate)",
        "exact": False,
        "errors_passed": WEEK4_FALLBACK["errors_passed"],
        "dangerous_passed": WEEK4_FALLBACK["dangerous_passed"],
        "escalated_count": round(WEEK4_FALLBACK["escalated"] * n),
    }


def main() -> int:
    state = load_model_state(get_settings(), get_inference_config())
    if state.model is None:
        print(f"Model not ready: {state.error}", file=sys.stderr)
        return 1
    model = state.model
    is_healthy = model.policy.is_healthy

    files, labels, preds, diagnosed, conf, required, times = [], [], [], [], [], [], []
    for label, key in enumerate(model.class_keys):
        class_dir = TEST_DIR / key
        paths = sorted(p for p in class_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
        for path in paths:
            p = model.predict(path.read_bytes())
            files.append(f"{key}/{path.name}")
            labels.append(label)
            preds.append(p.decision.class_index)
            diagnosed.append(p.decision.status == "diagnosed")
            conf.append(p.decision.confidence)
            required.append(p.decision.required)
            times.append(p.inference_ms)
            if len(files) % 500 == 0:
                print(f"  {len(files)} photos ...")

    labels_a, preds_a = np.array(labels), np.array(preds)
    diag_a, conf_a, req_a = np.array(diagnosed), np.array(conf), np.array(required)
    n = len(labels_a)

    wrong = diag_a & (preds_a != labels_a)
    dangerous = wrong & is_healthy[preds_a] & ~is_healthy[labels_a]
    acc_diag = float((preds_a[diag_a] == labels_a[diag_a]).mean()) if diag_a.any() else 0.0
    borderline = [files[i] for i in np.where(np.abs(conf_a - req_a) < BORDERLINE)[0]]
    latency = np.array(times[1:])  # skip the first photo: warm-up

    result = {
        "n_photos": n,
        "escalated_count": int((~diag_a).sum()),
        "escalated_rate": float((~diag_a).mean()),
        "accuracy_diagnosed": acc_diag,
        "errors_passed": int(wrong.sum()),
        "dangerous_passed": int(dangerous.sum()),
        "borderline_photos": borderline,
        "latency_ms": {
            "mean": round(float(latency.mean()), 2),
            "p95": round(float(np.percentile(latency, 95)), 2),
            "max": round(float(latency.max()), 2),
        },
    }
    expected = load_expected(n)

    esc_ok = (
        result["escalated_count"] == expected["escalated_count"]
        if expected["exact"]
        else abs(result["escalated_count"] - expected["escalated_count"]) <= max(1, n // 1000)
    )
    checks = {
        "errors_passed": result["errors_passed"] == expected["errors_passed"],
        "dangerous_passed": result["dangerous_passed"] == expected["dangerous_passed"],
        "escalated": esc_ok,
    }
    passed = all(checks.values())

    print(f"\n=== Service vs Week 4 on test ({n} photos), expected from {expected['source']} ===")
    print(f"{'':<18}{'service':>10}{'week 4':>10}")
    print(f"{'escalated':<18}{result['escalated_count']:>10}{expected['escalated_count']:>10}")
    print(f"{'errors passed':<18}{result['errors_passed']:>10}{expected['errors_passed']:>10}")
    print(f"{'dangerous':<18}{result['dangerous_passed']:>10}{expected['dangerous_passed']:>10}")
    print(
        f"\naccuracy on diagnosed: {acc_diag:.4f}   escalated rate: {result['escalated_rate']:.1%}"
    )
    print(f"latency ms: mean {result['latency_ms']['mean']}  p95 {result['latency_ms']['p95']}")
    print(f"borderline photos (within {BORDERLINE} of a threshold): {len(borderline)}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {"result": result, "expected": expected, "checks": checks, "passed": passed}, indent=2
        ),
        encoding="utf-8",
    )
    print(f"\nsaved to {OUT_PATH.relative_to(SERVICE_ROOT)}")
    print("PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
