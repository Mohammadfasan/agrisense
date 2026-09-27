**Week 5 in progress** (branch `feat/week-5-ml-service`)

- Day 19: ONNX-only ml-service (in-graph CAM = Grad-CAM, proven), model via
  GitHub Release `model-v1.0.0` + pinned SHA256, `/ready` 503 with reason.
- Day 20: inference core — preprocess (bit-identical to training), policy
  (T=1.173, 0.70/0.90), 7×7 heatmap grid. Service reproduces Week 4 test
  numbers exactly (120 escalated / 20 errors / 7 dangerous), ~9 ms.
- Day 21: `POST /v1/diagnose`, internal key, 2-layer size limit, 19 pytest.
- Day 22 Part A: Node scans module — `PUT/GET /api/v1/scans/:id`, photo
  storage interface, ML client, farmer view hides escalated diagnoses.
  387 server tests. End-to-end verified with real services.
- Next: Day 22 Part B — retry for `pending` scans.

**Known environment issues** (add)

- `tsx watch` does not reload `.env` — restart `npm run dev` after changes.
- Run server commands from `server/`, git from the repo root.
- CMD: use `for /f ... do @set` to avoid echoing secrets.
