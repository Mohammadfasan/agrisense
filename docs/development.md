# Development

## Prerequisites

- Node 20 LTS (the repo also runs on 22; `engines` allows both)
- npm 10
- Python 3.11+ for `ml-service`
- Docker, for MongoDB and Redis

## First run

```bash
npm install                 # server + client workspaces and root tooling
cp server/.env.example server/.env
npm run docker:up           # mongo:6 + redis:7-alpine + ml-service
```

The Python service is not an npm workspace, so its environment is created once:

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Scripts -> bin on POSIX
```

Then run whichever pieces you need:

```bash
npm run dev:server          # http://localhost:4000
npm run dev:client          # http://localhost:5173
npm run dev:ml              # http://localhost:8000
```

Wait for both containers to report healthy before expecting `/ready` to pass:

```bash
docker compose ps
```

## Scripts

Run from the repo root:

| Script                | What it does                                 |
| --------------------- | -------------------------------------------- |
| `npm run dev`         | Server in watch mode via `tsx`               |
| `npm run build`       | Type-check, emit to `dist/`, rewrite aliases |
| `npm start`           | Run the compiled build                       |
| `npm run typecheck`   | `tsc --noEmit` across every workspace        |
| `npm run lint`        | ESLint (type-aware) over the repo            |
| `npm run format`      | Prettier, write mode                         |
| `npm run docker:up`   | Start MongoDB + Redis                        |
| `npm run docker:down` | Stop them                                    |

### Port conflicts

`docker-compose.yml` publishes MongoDB on `${MONGO_PORT:-27017}` and Redis on
`${REDIS_PORT:-6379}`. If you already run a native `mongod` or `redis-server`,
the container will collide with it — on Windows a native service bound to
`127.0.0.1` also wins the `localhost` lookup, so the app silently talks to the
wrong server. Override the host port in a root `.env` (gitignored):

```ini
MONGO_PORT=27018
```

and point `server/.env` at it:

```ini
MONGODB_URI=mongodb://agrisense:agrisense@localhost:27018/agrisense?authSource=admin
```

## Probes

```bash
curl -s localhost:4000/health | jq
curl -s -i localhost:4000/ready      # 503 until MongoDB answers a ping
```

`/ready` also returns 503 with `"draining": true` once shutdown has begun, which
is what tells a load balancer to stop sending traffic before the process exits.

## Adding a feature module

1. `server/src/modules/<name>/` with `*.routes.ts`, `*.controller.ts`,
   `*.service.ts`, and an `index.ts` barrel.
2. Re-export the router from `server/src/modules/index.ts`.
3. Mount it on the versioned router in `server/src/app.ts`.

Keep `req`/`res` out of services — controllers translate HTTP, services hold the
logic. Wrap async handlers in `asyncHandler` so rejections reach the error
handler.

## Commit hook

husky runs `lint-staged` on pre-commit:

| Staged files            | Commands                    |
| ----------------------- | --------------------------- |
| `*.{ts,tsx,js,cjs,mjs}` | `eslint --fix`, `prettier`  |
| `*.{json,md,yml,yaml}`  | `prettier`                  |
| `ml-service/**/*.py`    | `black`, `ruff check --fix` |

The Python tools live in `ml-service/.venv`, whose binary directory differs by
platform (`Scripts` on Windows, `bin` elsewhere). `scripts/py-tool.mjs` resolves
it, so one lint-staged entry works everywhere; it prints setup instructions if
the venv is missing rather than failing cryptically.

To bypass in an emergency, `git commit --no-verify`.

## Client conventions

- `@/` resolves to `client/src/`. It is declared in **two** places —
  `tsconfig.app.json` for the type checker and `vite.config.ts` for the bundler.
  Both must be updated together.
- A feature is imported through its barrel (`@/features/farm`), never by
  reaching into another feature's files.
- Anything tappable gets `min-h-touch`/`min-w-touch` (44px).
- Every `t()` call passes an English default as its second argument, because the
  locale catalogues are intentionally empty.

## ML service conventions

- Routers do HTTP; `app/services/` holds inference logic and imports no FastAPI
  types.
- Config is read only through `get_settings()`. Relative paths in settings are
  anchored to the service root, so behaviour does not depend on the working
  directory.
- `training/` is never imported by the serving app — it only produces artifacts
  that `models/` then serves.

## Environment variables

`server/src/config/env.ts` is the single source of truth. Every variable is
declared in the Zod schema with a default or an explicit requirement; the
process exits with a readable report if validation fails. Add new variables
there and to `server/.env.example` in the same commit.
