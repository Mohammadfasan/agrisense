# ml-service

FastAPI inference service for crop-disease classification and yield forecasting.

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Scripts -> bin on macOS/Linux
npm run dev:ml                                                # from the repo root, :8000
```

Interactive API docs at <http://localhost:8000/docs>.

## Layout

```
app/
├── api/        Routers. HTTP in / HTTP out only.
├── core/       Config and the model registry.
├── services/   Inference logic. No FastAPI types in here.
└── schemas/    Pydantic request/response models.
models/         Per-type manifests and version directories.
training/       Offline pipelines. Never imported by the service.
```

## Endpoints

| Endpoint                     | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `GET /health`                | Liveness. Touches no models and no disk.      |
| `GET /models/active`         | Serving version of every model type.          |
| `GET /models/active/{type}`  | One type; 404 if it has no manifest.          |

## Model registry

`app/core/model_registry.py` resolves the serving version from the filesystem,
so promoting a model is a one-line edit to `active_version.json` — no code
change, no image rebuild:

```json
{
  "version": "v3",
  "artifact": "weights.onnx",
  "trained_at": "2026-01-14T09:12:00Z",
  "metrics": { "accuracy": 0.91 }
}
```

The response includes `artifact_present`, which is `false` when a manifest names
a file that has not been shipped. Both manifests are in exactly that state right
now — they are placeholders with no weights behind them.

`MODELS_DIR` may be relative; it is anchored to the service directory, not the
process working directory, so the service behaves the same started from
`ml-service/` or from the repo root.

## Python version

The container runs **3.11** (`Dockerfile`, and `requires-python = ">=3.11"`).
Only 3.12 is installed on this machine, so the local `.venv` is 3.12 — black and
ruff both target `py311`, which keeps 3.12-only syntax from creeping in.

## Tooling

```bash
npm run lint:py      # ruff
npm run format:py    # black
npm run test:py      # pytest
```

Both run on staged `.py` files via lint-staged. `scripts/py-tool.mjs` resolves
the venv binary per platform, so the hook works on Windows and POSIX alike.
