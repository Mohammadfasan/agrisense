# models

One directory per model type, each holding an `active_version.json` manifest and
a directory per version.

```
models/
├── disease/
│   ├── active_version.json     -> {"version": "v3", "artifact": "weights.onnx", ...}
│   └── v3/
│       └── weights.onnx
└── forecast/
    ├── active_version.json
    └── v3/
        └── model.pkl
```

Promoting a model is a one-line change to `active_version.json` — no code change
and no image rebuild. `app/core/model_registry.py` reads these at request time
and reports `artifact_present: false` when a manifest points at a file that has
not been shipped, which is exactly the state both directories are in now.

Version directories and weights are gitignored; ship them through your artifact
store or a volume mount.
