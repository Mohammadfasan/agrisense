# AgriSense — API Specification

**Base URL:** `/api/v1`
**Auth:** Bearer access token (`Authorization: Bearer <token>`)
**Version:** 0.2 — Day 10

> This file was created on Day 10 alongside the plots API. `/plots` is
> specified in full; `/auth` and `/farmers` are listed as built so the surface
> is complete, and will be filled in to the same depth as they are revisited.

---

## Conventions

| Concern       | Rule                                                             |
| ------------- | ---------------------------------------------------------------- |
| Content type  | `application/json` in and out                                    |
| Correlation   | `X-Request-Id` echoed on every response; generated when not sent |
| Success codes | `200` read/update, `201` create, `204` delete                    |
| Dates         | ISO 8601 UTC strings                                             |
| Coordinates   | GeoJSON — **longitude first**                                    |
| Validation    | Zod, shared with the PWA via `@agrisense/shared`                 |

### Error envelope

Every failure, from any endpoint, has this shape (`docs/architecture.md`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid plot",
    "requestId": "3f1c…",
    "details": [{ "path": "boundary.coordinates.0", "message": "a linear ring must be closed" }]
  }
}
```

| Status | When                                                           |
| ------ | -------------------------------------------------------------- |
| `400`  | Malformed JSON                                                 |
| `401`  | Missing, malformed or expired token                            |
| `403`  | Authenticated, but the role does not permit the route          |
| `404`  | Resource does not exist **or is not the caller's** — see below |
| `409`  | Duplicate key on a uniquely-indexed field                      |
| `422`  | Body, query or path parameter failed validation                |
| `429`  | Rate limited                                                   |
| `503`  | Draining, or a dependency is down                              |

---

## Authentication — `/auth`

| Method | Path           | Auth | Purpose                                      |
| ------ | -------------- | ---- | -------------------------------------------- |
| `POST` | `/otp/request` | —    | Send a login code to a phone number          |
| `POST` | `/otp/verify`  | —    | Exchange a code for an access/refresh pair   |
| `POST` | `/refresh`     | —    | Rotate the refresh token, issue a new access |
| `GET`  | `/me`          | ✓    | The authenticated farmer record              |

Refresh tokens rotate on every use and reuse revokes the whole family
(`docs/schema.md` §3).

---

## Farmer profile — `/farmers`

All routes require `authenticate` + role `farmer`.

| Method  | Path  | Purpose                                               |
| ------- | ----- | ----------------------------------------------------- |
| `GET`   | `/me` | Read own profile. `404 PROFILE_NOT_FOUND` if unfilled |
| `PUT`   | `/me` | Create (`201`) or replace (`200`) own profile         |
| `PATCH` | `/me` | Merge a partial profile                               |

There is deliberately no `/farmers/:id`: "me" is the only addressable profile.

---

## Plots — `/plots`

All routes require `authenticate` + role `farmer`, applied to the whole router.
Officers have no plots of their own; officer access to a farmer's plots will be
a separate, district-scoped, read-only route rather than a widened role here.

### The identifier

A plot's `_id` is a **UUID v4 the client generates**, not a server-minted
ObjectId (`docs/architecture.md`, ADR 001). Three consequences for callers:

- The id goes in the URL, and `PUT` is the create — there is no `POST /plots`.
- Only v4 is accepted. A v1 UUID is a `422`, not a `404`.
- Case is normalised to lower. The same UUID sent two ways is one plot.

### Security model

| Rule                                  | What a caller observes                          |
| ------------------------------------- | ----------------------------------------------- |
| Ownership is part of every query      | Another farmer's plot behaves as though absent  |
| Another farmer's plot returns **404** | Never `403` — a `403` confirms the id is in use |
| `userId` in a request body is ignored | Stripped by Zod; the owner is the token         |
| Soft-deleted plots are invisible      | `404` on read, patch, delete and replay         |

---

### `GET /api/v1/plots`

The caller's live plots, most recently updated first.

**Query**

| Param    | Type    | Default | Notes                            |
| -------- | ------- | ------- | -------------------------------- |
| `limit`  | integer | `20`    | 1–100. Out of range is a `422`   |
| `cursor` | string  | —       | Opaque, from a previous response |

**`200`**

```json
{
  "plots": [
    {
      "_id": "3f2b1c9e-6b1a-4f0c-9e2d-8a7b6c5d4e3f",
      "userId": "6720f1a2c3d4e5f60718293a",
      "name": "Upper field",
      "crop": "PADDY",
      "areaAcres": 2.5,
      "boundary": {
        "type": "Polygon",
        "coordinates": [
          [
            [80.4, 8.3],
            [80.402, 8.3],
            [80.402, 8.302],
            [80.4, 8.302],
            [80.4, 8.3]
          ]
        ]
      },
      "centroid": { "type": "Point", "coordinates": [80.401, 8.301] },
      "plantedAt": "2026-05-01T00:00:00.000Z",
      "notes": "Waterlogs near the bund after heavy rain.",
      "version": 1,
      "deletedAt": null,
      "createdAt": "2026-09-16T04:10:00.000Z",
      "updatedAt": "2026-09-16T04:10:00.000Z"
    }
  ],
  "nextCursor": "MjAyNi0wOS0xNlQwNDoxMDowMC4wMDBafDNmMmIxYzll…"
}
```

`nextCursor` is `null` on the last page. Pass it back as `?cursor=` to continue.

**Paging.** Cursor, not `skip`/`limit`. The list is ordered by `updatedAt`
descending, so an edit made between two offset pages reorders the list under
the reader and a row crosses the page boundary — served twice, or missed. A
cursor names a position in the ordering instead of counting from the start. It
encodes `updatedAt` _and_ `_id`, because two plots saved in the same
millisecond share a timestamp and a timestamp-only cursor would skip the
second of them.

The cursor is opaque. Its contents are the server's business and its format may
change; clients echo back what they were given. One this server did not issue
is a `422`.

| Status | Meaning                        |
| ------ | ------------------------------ |
| `422`  | Bad `limit`, or a bad `cursor` |

---

### `GET /api/v1/plots/:id`

**`200`** — `{ "plot": { … } }`, the object shown above.

| Status | Meaning                                                           |
| ------ | ----------------------------------------------------------------- |
| `404`  | No such plot, not yours, or deleted — these are indistinguishable |
| `422`  | `:id` is not a UUID v4                                            |

---

### `PUT /api/v1/plots/:id`

Create the plot under the client's own UUID, or replace it if it is there.
**This is the endpoint offline sync replays into**, so running it twice with
the same body leaves exactly what running it once did.

**Body** — `userId`, `version`, `deletedAt` and the timestamps are not accepted
and are stripped if sent.

| Field       | Type            | Required | Notes                                       |
| ----------- | --------------- | -------- | ------------------------------------------- |
| `name`      | string          | ✓        | 1–60 chars, trimmed                         |
| `crop`      | enum            | ✓        | `PADDY` `TOMATO` `CHILLI` `ONION` `BRINJAL` |
| `areaAcres` | number          | ✓        | 0.01–1000                                   |
| `boundary`  | GeoJSON Polygon |          | See the polygon rules below                 |
| `centroid`  | GeoJSON Point   |          | Derived from `boundary` when omitted        |
| `plantedAt` | ISO date        |          |                                             |
| `notes`     | string          |          | ≤ 500 chars, trimmed                        |

At least one of `boundary` and `centroid` is required — a plot that cannot be
placed on the outbreak map is the one thing a plot may not be.

**Polygon rules.** `coordinates` is an array of linear rings, the first the
outer boundary. Each ring needs **at least 4 positions** and its **last
position must repeat its first**. Longitude is `-180..180`, latitude `-90..90`,
longitude first. A ring that is not closed is a `422`, not a `500` from the
driver.

**A replace, not a merge.** `PUT` is defined on the whole resource, so an
optional field left out of the body is cleared rather than kept. Use `PATCH` to
change one field.

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| `201`  | Created                                                              |
| `200`  | Replaced an existing plot of the caller's. `version` incremented     |
| `404`  | That UUID belongs to another farmer, or to a plot the caller deleted |
| `422`  | Body or `:id` failed validation                                      |

The `404` covers two cases on purpose. Another farmer's id must not come back
as a `409`, which would confirm the id exists; and a deleted plot's id stays
reserved, so a replayed create cannot resurrect what the farmer removed.

---

### `PATCH /api/v1/plots/:id`

Merge a partial body. Same fields as `PUT`, all optional; absent fields are
left alone. Never creates — a `PATCH` at an id that does not exist is a `404`.

Sending a new `boundary` without a `centroid` moves the centroid to match. It
would otherwise keep pointing at the old outline, silently.

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| `200`  | `{ "plot": { … } }`, `version` incremented |
| `404`  | No such plot, not yours, or deleted        |
| `422`  | Body or `:id` failed validation            |

---

### `DELETE /api/v1/plots/:id`

Soft delete. The row stays, `deletedAt` is stamped and `version` is
incremented — a device syncing later needs the tombstone to read as the newest
version of the plot, or the delete never reaches it.

| Status | Meaning                                         |
| ------ | ----------------------------------------------- |
| `204`  | Deleted. No body                                |
| `404`  | No such plot, not yours, or **already deleted** |
| `422`  | `:id` is not a UUID v4                          |

Not idempotent in status: a second `DELETE` is a `404`. Answering `204` again
would mean overwriting the real deletion time with a later one.

---

## Error codes

Beyond the generic set in `docs/architecture.md`:

| Code                | Status | Meaning                                                       |
| ------------------- | ------ | ------------------------------------------------------------- |
| `PROFILE_NOT_FOUND` | 404    | Authenticated, but no farmer profile yet — open the form      |
| `PLOT_NOT_FOUND`    | 404    | No plot with that id is readable by this caller. Deliberately |
|                     |        | the same whether it is absent, another farmer's, or deleted   |
