# AgriSense

TypeScript monorepo for the AgriSense precision-agriculture platform.

```
server/       Node 20 + Express API              (npm workspace)
client/       React 18 + Vite PWA                (npm workspace)
ml-service/   Python 3.11 + FastAPI inference    (venv, not an npm workspace)
docs/         Architecture & development notes
```

## Quick start

```bash
npm install
cp server/.env.example server/.env
npm run docker:up            # mongo:6 + redis:7-alpine + ml-service

npm run dev:server           # API      http://localhost:4000
npm run dev:client           # PWA      http://localhost:5173
npm run dev:ml               # ML       http://localhost:8000
```

The ML service is Python, so it is deliberately **not** an npm workspace. Set it
up once:

```bash
cd ml-service && python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Scripts -> bin on POSIX
```

## What the server ships with

- **Strict TypeScript** — `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`
- **Path aliases** — `@config`, `@modules`, `@shared` (`tsx` at dev time,
  `tsc-alias` for the build, so `dist/` needs no loader)
- **Zod-validated env** — invalid config exits at boot with a readable report
- **Winston logging** — pretty in development, JSON in production, child loggers
  bound to the request id
- **MongoDB via mongoose** — pooled, with connection-state tracking
- **`AppError`** — typed status/code/details, operational vs. defect
- **Error handler** — one JSON envelope for Zod, mongoose, and unknown errors
- **`requestId`** — honours an inbound `X-Request-Id`, echoes it, attaches `req.log`
- **`/health` and `/ready`** — liveness and dependency-checking readiness
- **Graceful shutdown** — refuses new work via `drainGuard`, flips `/ready` to
  `not_ready`, drains in-flight requests, closes Mongo, bounded by a timeout

Details in [docs/architecture.md](./docs/architecture.md).

## What the client ships with

- **Offline-first** — every write lands in IndexedDB and an outbox queue in one
  Dexie transaction; the UI never waits on the network
- **Design tokens** — `primary`/`danger`/`warning`/`muted` aliased to their real
  Tailwind scales, plus a 44px `touch` minimum target
- **Trilingual** — English, Tamil and Sinhala, with per-script line-height
- **Installable** — `vite-plugin-pwa`, with map tiles and API responses cached
- **Code-split** — Leaflet and Recharts stay off the initial load

See [client/README.md](./client/README.md).

## What the ML service ships with

- **FastAPI** on Python 3.11, with `/health` and `/models/active`
- **Filesystem model registry** — promote a model by editing
  `active_version.json`, no rebuild
- **Dockerfile** — non-root user, layered deps, healthcheck

See [ml-service/README.md](./ml-service/README.md).

## Tooling

One ESLint 9 flat config (type-aware, with React rules scoped to `client/`), one
Prettier config, and black + ruff for Python — all three wired into a single
husky pre-commit hook via `lint-staged`. See
[docs/development.md](./docs/development.md).
