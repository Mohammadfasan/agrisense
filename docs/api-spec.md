# AgriSense — API Specification

**Base URL:** `/api/v1`
**Auth:** Bearer access token (`Authorization: Bearer <token>`)
**Version:** 0.3 — Day 11

> This file was created on Day 10 alongside the plots API. `/plots` and
> `/calendar` are specified in full; `/auth` and `/farmers` are listed as built
> so the surface is complete, and will be filled in to the same depth as they
> are revisited.

---

## Conventions

| Concern       | Rule                                                             |
| ------------- | ---------------------------------------------------------------- |
| Content type  | `application/json` in and out                                    |
| Correlation   | `X-Request-Id` echoed on every response; generated when not sent |
| Success codes | `200` read/update, `201` create, `204` delete                    |
| Dates         | ISO 8601 UTC strings — **except calendar days**, see `/calendar` |
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

## Crop calendar — `/calendar`

All routes require `authenticate` + role `farmer`, applied to the whole router.
Officers have no crops of their own.

### Days are not timestamps

`dueDate` and `completedOn` are **`YYYY-MM-DD` strings**, and the only fields in
this API that are not ISO 8601 instants. A farming task happens on a day, not at
a time. Sri Lanka is UTC+05:30, so a `Date` at local midnight serialises to
18:30 the previous day and every task in the app shifts back one.

- `"2026-02-30"` is a `422`. The shape is right and the day does not exist.
- `"15-03-2026"`, `"2026-3-15"` and `"2026-05-01T00:00:00.000Z"` are all `422`.
- Ranges compare as strings, which is exact: this format sorts lexically in the
  order it sorts chronologically.

`reminderAt` **is** an instant — a reminder is a moment — and is **reserved for
Week 9**. It is stored and returned; nothing reads it, and setting it schedules
nothing.

### The identifier

As with `/plots`: a task's `_id` is a **UUID v4**, `PUT` is the create, only v4
is accepted, and case is normalised to lower. Template tasks are minted by the
server in the same id space, because a client cannot be asked to care which end
made a task.

### Security model

| Rule                                  | What a caller observes                             |
| ------------------------------------- | -------------------------------------------------- |
| Ownership is part of every query      | Another farmer's task behaves as though absent     |
| Another farmer's task returns **404** | `CALENDAR_TASK_NOT_FOUND`, never `403`             |
| A write naming a plot proves it       | Another farmer's `plotId` returns `PLOT_NOT_FOUND` |
| `userId` in a request body is ignored | Stripped by Zod; the owner is the token            |
| `source` in a request body is ignored | Server-owned; `PUT` sets `manual` on insert        |

### The task object

```json
{
  "_id": "7c1d5f80-2a4b-4c3e-9f1a-6b2d8e4c7a90",
  "userId": "6720f1a2c3d4e5f60718293a",
  "plotId": "3f2b1c9e-6b1a-4f0c-9e2d-8a7b6c5d4e3f",
  "type": "fertilising",
  "title": "calendar.task.paddy.topDressing1.title",
  "notes": "calendar.task.paddy.topDressing1.description",
  "dueDate": "2026-05-15",
  "completedOn": null,
  "source": "template",
  "reminderAt": null,
  "version": 1,
  "deletedAt": null,
  "createdAt": "2026-05-01T04:10:00.000Z",
  "updatedAt": "2026-05-01T04:10:00.000Z"
}
```

**`title` is an i18n key when `source` is `template`**, and free text when it is
`manual`. The server does not choose which of three languages to write a
farmer's calendar in; the client translates at render time. `notes` carries the
description's key on the same terms.

---

### `GET /api/v1/calendar`

The caller's tasks in a date window, earliest first. Completed tasks are
included — the calendar is a record of what was done as well as a plan.

**Query**

| Param    | Type    | Default | Notes                         |
| -------- | ------- | ------- | ----------------------------- |
| `plotId` | UUID v4 | —       | One plot. Omit for every plot |
| `from`   | day     | —       | **Inclusive**                 |
| `to`     | day     | —       | **Inclusive**                 |
| `limit`  | integer | `200`   | 1–500                         |

**`200`** — `{ "tasks": [ … ] }`

There is no cursor. A calendar request is already bounded by the window a screen
is showing, and paging a date range is the client asking for a narrower one. The
`limit` exists so that "every task I have ever had" is still a bounded response.

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| `422`  | Bad day format, a day that does not exist, or `to` < `from` |

---

### `GET /api/v1/calendar/upcoming`

What is still to do, across every plot, earliest first.

**Query**

| Param   | Type    | Default | Notes |
| ------- | ------- | ------- | ----- |
| `days`  | integer | `7`     | 1–90  |
| `limit` | integer | `200`   | 1–500 |

Two things the name does not carry:

- **Completed tasks are excluded.** This is the "what do I do next" list; a
  ticked task answers a different question.
- **Overdue tasks are included**, not only the next `days`. A task due yesterday
  and not done is the most urgent thing a farmer owns, and a list that dropped
  it would hide a missed spray behind a clean screen. The window bounds the
  future end only.

"Today" is today in Sri Lanka, not in UTC — between 18:30 and midnight UTC the
two are different days.

---

### `GET /api/v1/calendar/:id`

**`200`** — `{ "task": { … } }`. `404` if absent, not yours, or deleted.

---

### `PUT /api/v1/calendar/:id`

Create or replace, under an id the client chose. Idempotent: this is what an
offline queue replays into.

**Body**

| Field        | Required | Notes                                      |
| ------------ | -------- | ------------------------------------------ |
| `plotId`     | ✓        | Must be one of the caller's live plots     |
| `type`       | ✓        | Activity type                              |
| `title`      | ✓        | 1–100 chars                                |
| `notes`      |          | Max 500; omitted clears it to `null`       |
| `dueDate`    | ✓        | `YYYY-MM-DD`                               |
| `reminderAt` |          | ISO instant or `null`. Reserved for Week 9 |

`source` and `completedOn` are **not** in the body. `source` is server-owned.
`completedOn` is lifecycle state rather than content — like `version` and
`deletedAt`, which `PUT` does not clear either — so a phone replaying a
two-day-old title edit cannot silently un-tick work the farmer has since
finished.

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| `201`  | Created                                                     |
| `200`  | Replaced                                                    |
| `404`  | `plotId` is not the caller's, or the task id is a tombstone |
| `422`  | Bad body, or `:id` is not a UUID v4                         |

---

### `PATCH /api/v1/calendar/:id`

Merges the given fields; absent ones are left alone. Never upserts.

Accepts everything `PUT` does, plus `completedOn` — including `null`, which is
how a farmer undoes a tick they did not intend. A `PATCH` names the field it
means, which is exactly what an omitted field in a `PUT` does not.

**`200`** — `{ "task": { … } }`

---

### `POST /api/v1/calendar/:id/complete`

Ticks a task off. **`200`** — `{ "task": { … } }`.

**Body** — optional. `{ "completedOn": "2026-05-19" }`, or `{}`.

The day comes from the client when it sends one, because the phone knows what
day it is where the farmer is standing. The server's fallback is today in
Colombo.

Idempotent: completing an already-completed task overwrites the day rather than
failing, so a replayed tap does not raise an error about work that is
demonstrably done. The task stays in `GET /calendar`; it drops out of
`/upcoming`.

---

### `DELETE /api/v1/calendar/:id`

Soft delete, on the same terms as `DELETE /plots/:id`: the row stays, the id
stays reserved, `version` is incremented, and a second `DELETE` is a `404`.

Deleting a **plot** deletes its calendar too, manual tasks included. They are
work on a field the farmer has just said they no longer have.

---

## Error codes

Beyond the generic set in `docs/architecture.md`:

| Code                      | Status | Meaning                                                       |
| ------------------------- | ------ | ------------------------------------------------------------- |
| `PROFILE_NOT_FOUND`       | 404    | Authenticated, but no farmer profile yet — open the form      |
| `PLOT_NOT_FOUND`          | 404    | No plot with that id is readable by this caller. Deliberately |
|                           |        | the same whether it is absent, another farmer's, or deleted   |
| `CALENDAR_TASK_NOT_FOUND` | 404    | The same, for a calendar task. A write naming a plot the      |
|                           |        | caller does not own answers `PLOT_NOT_FOUND` instead          |
