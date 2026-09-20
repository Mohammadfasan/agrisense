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
scripts/        Dataset tooling. Offline, and not imported either.
data/           The corpus and its split. No images in git; see data/README.md.
reports/        Generated figures and inspection output. Not in git.
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

## Dataset preparation

The classifier's corpus lives in `data/`, one directory per class. **Nothing in
this repo downloads it** -- the source and its licence are the operator's
decision -- and nothing here trains. `data/README.md` has the layout, what is
tracked and why, and the caveat about re-splitting a corpus that has grown.

```bash
npm run data:inspect                   # look before you split
npm run data:prepare -- --dry-run      # counts and warnings, writes nothing
npm run data:prepare                   # split, resize, write the manifest
```

`scripts/inspect_dataset.py` reports the class distribution (with a bar chart to
`reports/class_distribution.png`), mean and median image size, files that will
not decode, and byte-identical duplicates. Duplicates spanning two classes are
called out separately: those are a labelling conflict rather than a duplicate.

`scripts/prepare_dataset.py` splits each class 70/15/15 from a fixed seed,
resizes to 224x224 RGB JPEG and writes `data/manifest.json` -- the seed, the
ratios and the per-class counts that a reported accuracy is checked against.
It flags any class under 100 images as a risk and carries on; it refuses to
overwrite a previous run without `--force`, because a directory holding two
seeds' output is a split nobody can reason about afterwards.

Both take `--help`. `matplotlib` is in `requirements-dev.txt` and not in
`requirements.txt`: the inference image has no use for a plotting stack, and
`inspect_dataset.py` runs without it, skipping only the chart.

## Tooling

```bash
npm run lint:py      # ruff
npm run format:py    # black
npm run test:py      # pytest
```

Both run on staged `.py` files via lint-staged. `scripts/py-tool.mjs` resolves
the venv binary per platform, so the hook works on Windows and POSIX alike.
