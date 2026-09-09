# AgriSense — Architecture

## Layout

```
agrisense/
├── server/       Node 20 + Express + TypeScript API   (npm workspace)
├── client/       React 18 + Vite PWA                  (npm workspace)
├── ml-service/   Python 3.11 + FastAPI                (venv, not a workspace)
└── docs/         This documentation
```

Tooling is hoisted to the root: one ESLint flat config, one Prettier config, one
`tsconfig.base.json` that every TypeScript package extends, and one husky
pre-commit hook. `ml-service` is Python, so it stays outside the npm workspace
graph and is linted by black + ruff through `scripts/py-tool.mjs`.

## Service boundaries

```
client (PWA)  ──HTTP──>  server (Express)  ──HTTP──>  ml-service (FastAPI)
    │                        │
    └── IndexedDB            └── MongoDB, Redis
        (offline queue)
```

The browser never calls the ML service directly — the Node API owns auth,
validation and rate limiting, and is the only client the ML service expects.

## Server layers

Requests flow strictly downward; nothing in `shared/` imports from `modules/`.

| Layer      | Alias      | Responsibility                                           |
| ---------- | ---------- | -------------------------------------------------------- |
| `config/`  | `@config`  | Env parsing, logger, database connection. No HTTP types. |
| `shared/`  | `@shared`  | Cross-cutting HTTP concerns: `AppError`, middleware.     |
| `modules/` | `@modules` | Feature slices — routes, controllers, services, models.  |

A feature module owns its own folder and re-exports through an `index.ts`:

```
modules/health/
├── health.routes.ts       Router — path → controller
├── health.controller.ts   HTTP in / HTTP out only
├── health.service.ts      Business logic, no `req`/`res`
└── index.ts               Public surface of the module
```

Aliases are declared in `server/tsconfig.json`. `tsx` resolves them at dev time;
`tsc-alias` rewrites them to relative paths after `tsc` emits, so `dist/` runs on
plain Node with no loader.

## Startup and shutdown

`startServer()` binds the HTTP listener **before** connecting to MongoDB. If
Mongo is unreachable the process still answers `/health` and reports
`not_ready` on `/ready`, which lets an orchestrator tell "still starting" apart
from "crashed". Mongoose retries in the background.

Shutdown is triggered by `SIGINT`, `SIGTERM`, an unhandled rejection, or an
uncaught exception, and runs in this order:

1. `beginDraining()` flips the shared lifecycle flag.
2. `drainGuard` starts answering non-probe requests with `503` and sets
   `Connection: close`; `/ready` begins reporting `not_ready` with
   `"draining": true`, so the load balancer pulls the instance.
3. `server.close()` stops accepting connections and waits for in-flight
   requests to finish.
4. MongoDB disconnects, then the process exits.

`SHUTDOWN_TIMEOUT_MS` bounds the drain — an unref'd timer forces the exit if a
socket refuses to close.

Two details matter here, and both were wrong before they were measured:

- **`server.close()` is not enough to stop serving.** An already-open
  keep-alive socket will carry another request after `close()` has been called.
  `drainGuard` is what actually refuses that work.
- **One `closeIdleConnections()` call is not enough to finish quickly.** A
  socket that is busy on the first sweep falls idle afterwards and then lingers
  until its `keepAliveTimeout` fires, stalling the drain for seconds. The sweep
  runs on a 100 ms interval until `close()` settles, which took a measured
  shutdown from ~6000 ms down to ~20 ms.

## Probes

| Endpoint  | Meaning                                   | Codes     |
| --------- | ----------------------------------------- | --------- |
| `/health` | Liveness. Process is up. No dependencies. | 200       |
| `/ready`  | Readiness. Pings MongoDB.                 | 200 / 503 |

Restart on a failing `/health`; pull from the load balancer on a failing
`/ready`. Both are excluded from request logging to keep probe traffic quiet.

## Errors

Handlers throw `AppError`; `errorHandler` is the only place that writes an error
response. It maps Zod issues, mongoose validation/cast errors, duplicate-key
(E11000) errors and malformed JSON onto the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "3f1c…",
    "details": [{ "path": "email", "message": "Invalid email" }]
  }
}
```

`isOperational` separates expected failures (logged at `warn`) from defects
(logged at `error`, message replaced with a generic one in production). Stack
traces are included in the body only outside production.

## Request correlation

`requestId` runs first, reusing an inbound `X-Request-Id` when it matches
`/^[A-Za-z0-9._:-]{1,128}$/` and generating a UUID otherwise. It echoes the id
on the response and attaches `req.log`, a Winston child logger bound to it, so
every line from a request carries the same id.
