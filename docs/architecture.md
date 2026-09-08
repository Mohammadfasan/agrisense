# AgriSense — System Architecture

**Version:** 1.0  
**Last updated:** 2026-09-09  
**Author:** fasan


---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Design Principles](#2-design-principles)
3. [System Context](#3-system-context)
4. [Component Architecture](#4-component-architecture)
5. [Client Architecture](#5-client-architecture)
6. [Server Architecture](#6-server-architecture)
7. [ML Service Architecture](#7-ml-service-architecture)
8. [Data Architecture](#8-data-architecture)
9. [Synchronisation Protocol](#9-synchronisation-protocol)
10. [Key Data Flows](#10-key-data-flows)
11. [Asynchronous Processing](#11-asynchronous-processing)
12. [Security Architecture](#12-security-architecture)
13. [Resilience & Failure Handling](#13-resilience--failure-handling)
14. [Deployment Architecture](#14-deployment-architecture)
15. [Observability](#15-observability)
16. [Architecture Decision Records](#16-architecture-decision-records)

---

## 1. Architectural Overview

AgriSense is a three-tier distributed system comprising an offline-capable
progressive web application, a layered Node.js API with asynchronous job
processing, and an independently deployable Python inference service.

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT TIER                           │
│   Farmer PWA          Officer Dashboard      Admin Panel     │
│   (offline-first)     (online)               (online)        │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS / WSS
┌──────────────────────────▼───────────────────────────────────┐
│                        EDGE TIER                             │
│   Nginx — TLS termination, rate limiting, CORS, compression  │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     APPLICATION TIER                         │
│  ┌────────────────────┐  ┌────────────────────┐              │
│  │ API Server         │  │ Worker Process     │              │
│  │ Express + TS       │  │ BullMQ consumers   │              │
│  │ Socket.io          │  │ Cron schedulers    │              │
│  └────────────────────┘  └────────────────────┘              │
└───┬──────────────┬──────────────┬────────────────────────────┘
    │              │              │
┌───▼──────┐ ┌─────▼─────┐ ┌──────▼──────────┐ ┌───────────────┐
│ MongoDB  │ │   Redis   │ │  ML Service     │ │ External      │
│ 2dsphere │ │ cache +   │ │  FastAPI        │ │ Cloudinary    │
│ replica  │ │ queue +   │ │  TF · Prophet   │ │ Weather API   │
│ set      │ │ pub/sub   │ │  scikit-learn   │ │ SMS gateway   │
└──────────┘ └───────────┘ └─────────────────┘ └───────────────┘
```

### Tier responsibilities

| Tier | Responsibility |
|------|----------------|
| Client | Presentation, local persistence, offline queueing, optimistic updates |
| Application | Authentication, authorisation, business rules, orchestration, sync arbitration |
| Inference | Model loading, preprocessing, prediction, explanation generation |
| Data | Durable storage, geospatial indexing, caching, job queueing |

---

## 2. Design Principles

The following principles guided the major structural decisions.

**P1 — Offline is the default, not a degraded mode.**  
The client is designed as if the network is unavailable, with connectivity
treated as an opportunistic enhancement. No user-facing operation blocks on a
network call.

**P2 — The network boundary is invisible to the UI.**  
Components interact with a repository interface, never with HTTP directly. Where
data comes from — cache or server — is not a concern the UI carries.

**P3 — Uncertainty is surfaced, not hidden.**  
Model confidence and forecast intervals are shown to users. A prediction the
system cannot stand behind is escalated to a human rather than presented as an
answer.

**P4 — Inference is isolated from the application.**  
Model serving runs as a separate deployable so it can be scaled, versioned, and
failed independently of the API.

**P5 — Long operations are asynchronous.**  
Anything exceeding roughly one second is queued and its result delivered by push,
rather than held open on an HTTP request.

**P6 — Failures degrade, they do not cascade.**  
Every outbound dependency has a defined behaviour when unavailable.

---

## 3. System Context

```
                    ┌─────────────┐
                    │   Farmer    │
                    └──────┬──────┘
                           │ scans, logs, checks prices
                           ▼
    ┌─────────┐     ┌──────────────┐     ┌──────────────┐
    │ Officer ├────►│              │◄────┤ Market Admin │
    └─────────┘     │  AgriSense   │     └──────────────┘
                    │              │
    ┌─────────┐     │              │     ┌──────────────┐
    │  Admin  ├────►│              ├────►│ Weather API  │
    └─────────┘     └───────┬──────┘     └──────────────┘
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
            ┌──────────┐ ┌──────┐ ┌────────┐
            │Cloudinary│ │ SMS  │ │ Push   │
            └──────────┘ └──────┘ └────────┘
```

### External dependencies

| System | Purpose | Failure behaviour |
|--------|---------|-------------------|
| Cloudinary | Image storage and transformation | Upload retried from client queue |
| OpenWeather | Weather context for advisories and outbreak risk | Advisory generated without weather term |
| SMS gateway | OTP and critical alerts | OTP falls back to in-app; alerts queued |
| Web Push | Non-critical notifications | Delivered in-app on next open |

---

## 4. Component Architecture

### 4.1 Component inventory

| Component | Technology | Deployable | Scales |
|-----------|-----------|-----------|--------|
| Farmer PWA | React 18, TypeScript, Vite | Static (CDN) | Edge |
| API Server | Node 20, Express, TypeScript | Container | Horizontal |
| Worker | Node 20, BullMQ | Container | Horizontal |
| ML Service | Python 3.11, FastAPI | Container | Horizontal (CPU-bound) |
| Database | MongoDB 6 | Managed | Replica set |
| Cache / Queue | Redis 7 | Managed | Single (sufficient at scale) |

### 4.2 Inter-component communication

| From | To | Protocol | Sync/Async |
|------|-----|----------|-----------|
| Client | API | HTTPS REST | Sync |
| Client | API | WebSocket | Async (push) |
| API | Worker | Redis queue | Async |
| Worker | ML Service | HTTP | Sync (with circuit breaker) |
| Worker | Client | Redis pub/sub → Socket.io | Async |
| API / Worker | MongoDB | TCP (driver) | Sync |

### 4.3 Why the worker is a separate process

The API and worker share a codebase but run as distinct processes. This
separation exists because inference jobs are CPU-bound and long-running; hosting
them in the request-handling process would block the event loop and degrade
latency for unrelated requests. Separate processes also allow the two to scale on
different signals — API on request rate, worker on queue depth.

---

## 5. Client Architecture

### 5.1 Layered structure

```
┌──────────────────────────────────────────────┐
│ PRESENTATION                                 │
│ Pages · Feature components · Layouts         │
├──────────────────────────────────────────────┤
│ STATE                                        │
│ Zustand (client state) · TanStack Query      │
├──────────────────────────────────────────────┤
│ REPOSITORY                ◄── key boundary   │
│ scanRepo · plotRepo · priceRepo              │
│ Uniform interface regardless of connectivity │
├──────────────────────────────────────────────┤
│ PERSISTENCE                                  │
│ Dexie (IndexedDB) · Outbox · Sync engine     │
├──────────────────────────────────────────────┤
│ SERVICE WORKER                               │
│ Workbox · Precache · Runtime cache · BG Sync │
└──────────────────────────────────────────────┘
```

### 5.2 The repository boundary

This is the most consequential decision in the client design.

Components do not call the API. They call a repository:

```
scanRepo.create(payload)
```

Internally the repository:

1. Generates a client UUID for the record
2. Writes to IndexedDB immediately with `syncState: 'pending'`
3. Returns to the caller — the UI updates optimistically
4. Appends a mutation to the outbox
5. Signals the sync engine, which dispatches now if online, or registers a
   Background Sync tag if not

The consequence is that no component contains connectivity logic. There is no
`if (isOnline)` branch anywhere in the presentation layer, and offline behaviour
is testable in isolation from the UI.

### 5.3 Caching strategy

| Resource | Strategy | Rationale |
|----------|----------|-----------|
| App shell | Precache | Must load instantly and without network |
| Crop / disease master data | StaleWhileRevalidate | Changes rarely, required offline |
| Disease reference guide | CacheFirst, 30-day TTL | Large, static, read repeatedly |
| Market prices | NetworkFirst, cache fallback | Freshness preferred, staleness acceptable |
| Scan images | CacheFirst, LRU (50 entries) | Bounded to protect device storage |
| Mutating requests | Background Sync queue | Replayed when connectivity returns |

### 5.4 Local schema

| Store | Purpose | Sync direction |
|-------|---------|----------------|
| `plots` | Registered land parcels | Bidirectional |
| `plantings` | Active crops and stages | Bidirectional |
| `scans` | Disease scans and results | Push local, pull verified |
| `activities` | Farming activity log | Push only (append-only) |
| `prices` | Cached market prices | Pull only |
| `masterData` | Crops, diseases, treatments | Pull only |
| `outbox` | Pending mutations | Local only |
| `syncMeta` | Cursor, device ID, last sync | Local only |

---

## 6. Server Architecture

### 6.1 Request pipeline

```
Request
  │
  ├─ helmet            security headers
  ├─ cors              origin allowlist
  ├─ requestId         correlation ID for tracing
  ├─ rateLimit         per-route limits
  ├─ authenticate      JWT verification
  ├─ authorise         role check
  ├─ scopeToDistrict   officer data isolation
  ├─ validate          Zod schema
  │
  ▼
Controller ──► Service ──► Repository ──► MongoDB
  │              │
  │              └──► Queue / ML client / Cache
  ▼
Response
  │
  └─ errorHandler      normalised error envelope
```

### 6.2 Layer contracts

| Layer | May do | Must not do |
|-------|--------|-------------|
| Controller | Parse request, call one service, shape response | Contain business rules or query the database |
| Service | Business logic, orchestrate repositories and integrations | Reference `req` or `res` |
| Repository | Database queries and aggregations | Contain business rules |

The service layer is deliberately free of HTTP concerns so that the same logic is
invoked identically from an HTTP handler, a queue worker, a scheduled job, and a
test — without a transport in the middle.

### 6.3 Module layout

```
server/src/
├── config/            env (Zod-validated), db, redis, logger
├── modules/
│   ├── auth/          OTP, JWT issuance, refresh rotation
│   ├── farmer/
│   ├── plot/          geospatial CRUD
│   ├── crop/          master data, growth-stage engine
│   ├── scan/          upload, queue dispatch, result retrieval
│   ├── market/        prices, forecast retrieval, alerts
│   ├── outbreak/      cluster retrieval, thresholds
│   ├── advisory/      broadcast composition and delivery
│   └── sync/          push / pull endpoints
├── middleware/
├── jobs/              queues, workers, schedulers
├── integrations/      mlClient, cloudinary, weather, sms
├── realtime/          Socket.io rooms and events
└── shared/            errors, types, utilities
```

---

## 7. ML Service Architecture

### 7.1 Structure

```
ml-service/
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── disease.py       POST /predict/disease
│   │   ├── forecast.py      POST /forecast/price
│   │   └── outbreak.py      POST /detect/outbreak
│   ├── core/
│   │   ├── model_registry.py
│   │   └── config.py
│   ├── services/
│   └── schemas/             Pydantic contracts
├── models/
│   ├── disease/
│   │   ├── v1.0.0/  v1.1.0/  v1.2.0/
│   │   └── active_version.json
│   └── forecast/
└── training/                notebooks, scripts, evaluation
```

### 7.2 Model registry

Each model version directory contains the serialised model, its label mapping,
and the evaluation metrics recorded at training time. An `active_version.json`
manifest determines which version loads at startup.

Every prediction response includes the `modelVersion` that produced it. This makes
any historical diagnosis traceable to a specific model, which matters when a
disagreement between farmer, officer, and system needs to be investigated — and
when evaluating whether a newer model actually improved outcomes.

### 7.3 Disease inference pipeline

```
Image bytes
  │
  ├─ Validate         format, dimensions, size ceiling
  ├─ Preprocess       resize 224×224, normalise
  ├─ Inference        MobileNetV2 forward pass
  ├─ Postprocess      softmax, top-3
  │
  ├─ Confidence gate
  │    ≥ 0.75  → return as diagnosis
  │    0.50–0.75 → return with officer-review recommendation
  │    < 0.50  → return as inconclusive with recapture guidance
  │
  ├─ Grad-CAM         activation heatmap for the predicted class
  └─ Response         disease, confidence, severity, heatmap, modelVersion
```

The confidence gate is a product decision expressed in the architecture. A
classifier always produces a top class; whether that class is worth presenting as
an answer is a separate question. Applying a fungicide based on a 40%-confidence
guess has a real cost to a farmer, so the system declines to answer rather than
answering badly.

### 7.4 Forecast pipeline

```
Historical series (365 days)
  │
  ├─ Clean            outliers, gap fill, festival flags
  │
  ├─ Prophet          additive seasonality + Sri Lankan holidays
  ├─ LSTM             multivariate: price, rainfall, volume, month
  │
  ├─ Ensemble         weighted by rolling validation MAPE
  ├─ Intervals        prediction bands
  └─ Response         daily point + lower/upper, MAPE, modelVersion
```

### 7.5 Outbreak detection

```
Verified scans (district, trailing 14 days)
  │
  ├─ DBSCAN           spatio-temporal clustering (haversine + time)
  ├─ Density          scans per km², growth rate over window
  ├─ Weather risk     humidity and temperature suitability per disease
  ├─ Risk score       weighted composite
  └─ Threshold        ≥10 same-disease scans within 5 km over 7 days
```

---

## 8. Data Architecture

### 8.1 Collections

| Collection | Purpose | Growth |
|------------|---------|--------|
| `farmers` | Identity and preferences | Low |
| `plots` | Land parcels, GeoJSON polygons | Low |
| `plantings` | Crop instances per plot | Medium |
| `activities` | Farming activity log | High |
| `scans` | Disease scans and results | High |
| `crops` | Master: crops, stages, translations | Static |
| `diseases` | Master: symptoms, treatments, PHI | Static |
| `markets` | Market master data | Static |
| `marketPrices` | Daily price observations | High |
| `priceForecasts` | Generated forecasts | Medium |
| `outbreaks` | Detected clusters | Low |
| `advisories` | Officer broadcasts | Low |
| `syncLog` | Applied client mutations | High |

### 8.2 Indexing strategy

| Collection | Index | Serves |
|------------|-------|--------|
| `plots` | `{ boundary: '2dsphere' }` | District resolution, radius queries |
| `scans` | `{ location: '2dsphere' }` | Outbreak clustering |
| `scans` | `{ plotId: 1, createdAt: -1 }` | Plot scan history |
| `scans` | `{ district: 1, disease: 1, createdAt: -1 }` | Officer dashboard |
| `scans` | `{ clientId: 1 }` unique | Sync idempotency |
| `marketPrices` | `{ cropId: 1, marketId: 1, date: -1 }` | Price series retrieval |
| `syncLog` | `{ clientId: 1 }` unique | Duplicate mutation rejection |
| `farmers` | `{ phone: 1 }` unique | Login |

### 8.3 Data retention

| Data | Retention |
|------|-----------|
| Scan images | 12 months, then thumbnail only |
| Sync log | 90 days |
| Refresh tokens | Until expiry, then purged nightly |
| Price observations | Indefinite (training data) |
| Officer corrections | Indefinite (training data) |

---

## 9. Synchronisation Protocol

### 9.1 Push — client to server

```
POST /api/v1/sync/push

{
  "deviceId": "...",
  "mutations": [
    {
      "clientId": "<uuid>",
      "entity": "scan",
      "operation": "create",
      "payload": { ... },
      "clientUpdatedAt": "..."
    }
  ]
}
```

Server processing per mutation:

1. Look up `clientId` in `syncLog`. If present, skip and report as applied —
   the operation is idempotent.
2. Validate the payload against the entity schema.
3. For updates, compare server version against the client's base version.
4. On mismatch, resolve by entity rule and report the outcome.
5. Record `clientId` in `syncLog`.

```
Response
{
  "applied":   [{ "clientId": "...", "serverId": "..." }],
  "conflicts": [{ "clientId": "...", "resolution": "server_wins",
                  "serverValue": { ... } }],
  "rejected":  [{ "clientId": "...", "reason": "..." }],
  "serverTime": "..."
}
```

### 9.2 Pull — server to client

```
GET /api/v1/sync/pull?since=<cursor>

{
  "changes":   { "scans": [...], "prices": [...],
                 "advisories": [...], "masterData": [...] },
  "deletions": [{ "entity": "...", "id": "..." }],
  "serverTime": "..."
}
```

The cursor is issued by the server and echoed back by the client. Client clocks
are not trusted for delta boundaries — on a device with a skewed clock, using
local time as the boundary would silently drop changes.

### 9.3 Conflict resolution rules

| Entity | Rule | Justification |
|--------|------|---------------|
| Farmer profile | Last write wins | Single-author data; conflicts are rare and low-consequence |
| Plot boundary | Client wins, flagged for officer review | The farmer has ground truth about their own land |
| Scan result | Server wins | Model output and officer verification are authoritative |
| Activity log | Merge, append-only | Records of past events; none should be discarded |
| Alert preferences | Last write wins | Trivially re-settable by the user |

### 9.4 Guarantees

| Property | Mechanism |
|----------|-----------|
| At-least-once delivery | Client retries until server acknowledges |
| Exactly-once application | `clientId` uniqueness in `syncLog` |
| Ordering within entity | Outbox drains in insertion order |
| No silent loss | Every mutation resolves to applied, conflicted, or rejected |

---

## 10. Key Data Flows

### 10.1 Offline scan, end to end

```
1  Farmer captures leaf photograph (device offline)
2  Client compresses image (~4 MB → ~400 KB)
3  Record written to IndexedDB with generated clientId
4  UI displays result placeholder, marked pending
5  Outbox entry created; Background Sync tag registered
   ─────────── connectivity returns ───────────
6  Service worker replays queued request
7  API authenticates, validates, uploads image to Cloudinary
8  Scan document persisted with status 'processing'
9  Job enqueued; API responds 202 Accepted
10 Worker invokes ML service through circuit breaker
11 Inference returns prediction, confidence, heatmap
12 Worker updates document to 'completed'
13 Result pushed to farmer's socket room
14 Outbreak evaluation triggered asynchronously
15 If threshold crossed: outbreak recorded, advisory dispatched
```

Steps 9 to 13 are asynchronous by design. Inference takes seconds; holding an
HTTP connection open for it on a mobile network invites timeouts and wasted
radio time. Acknowledging receipt and pushing the result decouples the two.

### 10.2 Price forecast generation

```
Daily 06:00  price-ingestion    external prices → marketPrices
Daily 07:00  forecast-generation
               for each (crop, market) with sufficient history:
                 fetch series → ML service → persist to priceForecasts
                 → invalidate Redis cache
On request   API reads persisted forecast (cache-first)
```

Forecasts are precomputed rather than generated per request. The inputs change
once daily, so computing on demand would repeat identical work and expose users
to multi-second latency for a value that is already determined.

---

## 11. Asynchronous Processing

### 11.1 Queues

| Queue | Trigger | Concurrency | Retry | Failure |
|-------|---------|-------------|-------|---------|
| `scan-inference` | Scan upload | 5 | 3, exponential | DLQ; manual category offered |
| `notification` | Alerts, advisories | 10 | 3 | DLQ; delivered in-app |
| `image-processing` | Post-upload | 3 | 2 | Original retained |

### 11.2 Scheduled jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `price-ingestion` | 06:00 daily | Import market prices |
| `forecast-generation` | 07:00 daily | Regenerate forecasts |
| `outbreak-detection` | Every 6 hours | Cluster and evaluate thresholds |
| `crop-stage-reminders` | 05:00 daily | Growth-stage task notifications |
| `price-alert-check` | 08:00 daily | Evaluate farmer thresholds |
| `drift-monitor` | Weekly | Officer correction rate |
| `cleanup` | 02:00 daily | Expired tokens, orphaned images |

---

## 12. Security Architecture

### 12.1 Authentication

Passwordless by design. Rural users manage many low-use accounts; a password
requirement produces either reuse or lockout, and adds a recovery flow that
depends on email access many users do not have.

```
Phone → OTP (6 digits, 5-minute TTL, 3 attempts, 3/hour)
     → Access token  (JWT, 15 minutes)
     → Refresh token (opaque, 7 days, rotating, reuse-detected)
```

Refresh token reuse invalidates the entire token family — a replayed token
indicates theft, and the safe response is to force re-authentication.

### 12.2 Authorisation

| Role | Scope |
|------|-------|
| Farmer | Own plots, plantings, scans, activities |
| Officer | All scans and outbreaks within assigned district |
| Market admin | Price data only |
| System admin | Master data, users, model metrics |

District scoping is applied as middleware that injects a filter into the query
context, rather than being written into each handler. Enforcement that depends
on every developer remembering it will eventually be forgotten.

### 12.3 Controls

| Layer | Control |
|-------|---------|
| Transport | TLS 1.3, HSTS, secure cookie attributes |
| Input | Zod validation, magic-byte file type verification, size ceilings |
| Rate limiting | OTP 3/hour/number; scans 20/day/farmer; global per-IP |
| Storage | Signed upload URLs; bcrypt-hashed OTPs; PII field encryption |
| Privacy | Plot coordinates fuzzed to ~500 m in any publicly visible aggregate |
| Audit | Officer verifications and advisory broadcasts logged immutably |

---

## 13. Resilience & Failure Handling

### 13.1 Failure matrix

| Failure | Detection | Response | User impact |
|---------|-----------|----------|-------------|
| ML service down | Circuit breaker (5 failures / 30 s) | Jobs held; manual categorisation offered | Diagnosis delayed, capture unaffected |
| MongoDB unavailable | Driver error | 503; client continues from IndexedDB | Reads served locally; writes queued |
| Redis unavailable | Connection error | Queue paused; sync accepted synchronously | Slower processing |
| Cloudinary failure | Upload error | Client retains image, retries with backoff | Delayed upload |
| Weather API failure | Timeout | Risk computed without weather term | Marginally less precise scoring |
| Client offline | `navigator.onLine` + probe | Full local operation | None on core flows |

### 13.2 Patterns applied

| Pattern | Location | Purpose |
|---------|----------|---------|
| Circuit breaker | ML client | Prevent cascading failure and thread exhaustion |
| Exponential backoff | Queue retries, client upload | Avoid amplifying transient failures |
| Idempotency key | Sync push | Make retries safe |
| Dead letter queue | All queues | Preserve failed jobs for inspection |
| Bulkhead | Separate API and worker processes | Contain resource exhaustion |
| Graceful degradation | ML, weather, SMS | Reduce function rather than fail |
| Health probes | `/health`, `/ready` | Orchestrator-driven recovery |

---

## 14. Deployment Architecture

### 14.1 Environments

| Environment | Purpose | Data |
|-------------|---------|------|
| Local | Development | Seeded fixtures |
| Staging | Integration verification | Anonymised subset |
| Production | Live | Real |

### 14.2 Topology

```
Development — docker compose
  client · server · worker · ml-service · mongo · redis

Production
  ┌──────────────┐
  │   Vercel     │  PWA, global CDN
  └──────┬───────┘
         │
  ┌──────▼───────────────────────────┐
  │   Render                         │
  │   API (2 instances) · Worker     │
  │   ML service (1 instance)        │
  └──────┬───────────────────────────┘
         │
  ┌──────▼────────┐ ┌──────────────┐ ┌────────────┐
  │ MongoDB Atlas │ │ Upstash Redis│ │ Cloudinary │
  │ replica set   │ │              │ │            │
  └───────────────┘ └──────────────┘ └────────────┘
```

### 14.3 Pipeline

```
push → lint → type-check → unit tests → integration tests
     → build images → deploy staging → smoke tests
     → manual approval → deploy production
```

Model artefacts are excluded from version control and distributed separately;
committing 15–50 MB binaries per training iteration would make the repository
unusable within weeks.

---

## 15. Observability

| Concern | Mechanism | Signal |
|---------|-----------|--------|
| Logs | Winston, structured JSON, correlation IDs | Request tracing across tiers |
| Errors | Sentry (client and server) | Exception rate and grouping |
| Metrics | `/metrics` endpoint | API latency, queue depth, inference latency |
| Health | `/health`, `/ready` | Liveness and readiness |
| Uptime | External monitor | Availability |
| **Model** | Custom dashboard | Confidence distribution, class distribution, **officer correction rate** |

The final row is the one that matters most over time. Application metrics reveal
whether the system is running; the correction rate reveals whether the model is
still right. A classifier trained on curated imagery drifts as it meets real
field conditions and new disease presentations, and without this signal that
drift is invisible until users stop trusting the output.

---

## 16. Architecture Decision Records

### ADR-001 — Separate ML inference service

**Status:** Accepted

**Context.** Disease classification and price forecasting require TensorFlow,
Prophet, and scikit-learn. The application tier is Node.js.

**Options considered.**
- Export models to ONNX and run inference in-process in Node
- Serve models from a separate Python service
- Use a managed inference platform

**Decision.** A separate FastAPI service.

**Rationale.** Grad-CAM requires access to intermediate layer activations, which
the ONNX runtime does not expose conveniently; Prophet has no Node equivalent.
Separation additionally permits independent scaling and model version rollout
without redeploying the API.

**Consequences.** An additional deployable and network hop, mitigated by
asynchronous invocation. Requires an explicit failure strategy — addressed by the
circuit breaker.

---

### ADR-002 — MongoDB over PostgreSQL

**Status:** Accepted

**Context.** The domain includes geospatial queries, variable-shape master data
with per-language translations, and high-write scan and activity logs.

**Decision.** MongoDB with 2dsphere indexing.

**Rationale.** Native geospatial support without an extension; nested
translation and growth-stage structures map to documents without join
proliferation; the flexible schema suited a design still evolving during a
12-week build.

**Consequences.** No cross-document transactions in the general case. Acceptable
because no operation in the domain requires multi-entity atomicity. Referential
integrity is enforced in the service layer.

---

### ADR-003 — Offline-first client rather than online-first with caching

**Status:** Accepted

**Context.** Target users work in areas with intermittent or absent coverage.
Field usage is the primary use case, not an exception.

**Options considered.**
- Online-first with a read cache
- Offline-first with a local database and outbox
- Native application with local storage

**Decision.** Offline-first PWA with IndexedDB and a mutation outbox.

**Rationale.** A read cache does not permit capturing new observations offline,
which is the primary field activity. Native applications would have provided
richer background capability but would have required separate codebases and an
app-store install step for users on constrained data plans.

**Consequences.** Substantially more client complexity — a sync engine, conflict
resolution, and local schema migrations. This is the largest single cost in the
build and the largest single differentiator in the result.

---

### ADR-004 — Confidence thresholding with human escalation

**Status:** Accepted

**Context.** The classifier always emits a top class. Presenting low-confidence
output as a diagnosis leads to incorrect pesticide application, which has direct
financial and environmental cost.

**Decision.** Predictions below 0.75 are qualified; below 0.50 they are declared
inconclusive and routed to an officer.

**Rationale.** The cost of a wrong answer exceeds the cost of no answer. An
uncertain system that says so retains user trust; one that guesses confidently
loses it permanently on the first bad outcome.

**Consequences.** Some scans return no immediate diagnosis, and officer review
capacity becomes a dependency. Officer corrections are retained as labelled
training data, converting the cost into a model improvement path.

---

### ADR-005 — Precomputed forecasts

**Status:** Accepted

**Context.** Forecast inputs update once daily; forecast computation takes
several seconds.

**Decision.** Generate forecasts on a daily schedule and serve from storage.

**Rationale.** On-demand generation would repeat identical computation across
users and impose multi-second latency for a value already determined by the
morning's data.

**Consequences.** Forecasts are at most 24 hours old — acceptable given daily
input granularity. Requires monitoring so that a failed generation job does not
silently serve stale forecasts.

---

### ADR-006 — BullMQ over a distributed log

**Status:** Accepted

**Context.** Inference and notification work must run outside the request path.

**Decision.** BullMQ on the existing Redis instance.

**Rationale.** Redis is already a dependency for caching and pub/sub. BullMQ
provides retries, backoff, dead-letter handling, and scheduling out of the box.
Kafka would introduce a further operational component for throughput far beyond
what this system requires.

**Consequences.** Queue durability is bounded by Redis persistence
configuration. Acceptable, since inference jobs are reconstructible from the
persisted scan document.

---

## Appendix A — Technology Summary

| Layer | Technology |
|-------|-----------|
| Client | React 18, TypeScript, Vite, Tailwind, Zustand, TanStack Query, Dexie, Workbox, react-i18next, Leaflet, Recharts |
| Server | Node 20, Express, TypeScript, Mongoose, Zod, BullMQ, Socket.io, Winston, Swagger |
| ML | Python 3.11, FastAPI, TensorFlow/Keras, Prophet, scikit-learn, OpenCV, Pydantic |
| Data | MongoDB 6, Redis 7 |
| Infrastructure | Docker, GitHub Actions, Vercel, Render, MongoDB Atlas, Upstash, Cloudinary |

## Appendix B — Related Documents

| Document | Contents |
|----------|----------|
| [`requirements.md`](requirements.md) | Scope, user stories, non-functional requirements |
| [`schema.md`](schema.md) | Collection definitions and indexes |
| [`api-spec.md`](api-spec.md) | Endpoint contracts |
| [`ml.md`](ml.md) | Datasets, training methodology, evaluation |
