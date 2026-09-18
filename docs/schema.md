# AgriSense — Database Schema

**Database:** MongoDB 6  
**ODM:** Mongoose  
**Version:** 1.0

---

## Conventions

| Convention       | Rule                                                        |
| ---------------- | ----------------------------------------------------------- |
| Collection names | lowercase plural (`farmers`, `scans`)                       |
| Field names      | camelCase                                                   |
| Timestamps       | `createdAt`, `updatedAt` — Mongoose `{ timestamps: true }`  |
| Soft delete      | `deletedAt: Date \| null` on user-owned entities            |
| References       | `ObjectId` with explicit `ref`                              |
| Geospatial       | GeoJSON, `2dsphere` index                                   |
| Translations     | Embedded object keyed by locale: `{ ta, si, en }`           |
| Identifiers      | `ObjectId`, **except** user-authored records — see below    |
| Sync version     | `version: Number`, `$inc` on every write, on synced records |

**Identifiers.** A record a farmer authors — `plots`, and the collections that
follow it — takes a **client-generated UUID v4 as its `_id`**, stored as a
`String`. Everything else, including all master data and every server-owned
record, keeps an `ObjectId`. The reason is offline sync: the client fixes the id
before the record has ever reached the server, which is what makes the sync
upsert idempotent. `docs/architecture.md`, ADR 001, has the full reasoning.

This supersedes the earlier `clientId: String` convention, which carried two
identities for one record. On such a collection `deletedAt` is load-bearing
rather than cosmetic: a hard delete would free the UUID for a replayed create to
resurrect.

**Locale object shape** — used wherever text is user-facing:

```
{ ta: "தக்காளி", si: "තක්කාලි", en: "Tomato" }
```

---

## Entity Relationships

```
farmers ──1:N──► plots ──1:N──► plantings ──1:N──► activities
   │                 │                │
   │                 └──1:N──► scans ─┘
   │                              │
   │                              └──N:1──► diseases
   │
   └──1:N──► priceAlerts ──N:1──► crops
                                     │
markets ──1:N──► marketPrices ───────┤
   │                                 │
   └──1:N──► priceForecasts ─────────┘

officers (farmers with role) ──1:N──► advisories
                              ──1:N──► outbreaks (acknowledged)
```

---

## 1. `farmers`

Primary user identity. Officers and admins are stored here with an elevated
`role` rather than in a separate collection — the shared fields dominate.

| Field               | Type     | Required | Notes                                              |
| ------------------- | -------- | -------- | -------------------------------------------------- |
| `_id`               | ObjectId | ✓        |                                                    |
| `phone`             | String   | ✓        | E.164, unique                                      |
| `name`              | String   | ✓        |                                                    |
| `role`              | Enum     | ✓        | `farmer` \| `officer` \| `market_admin` \| `admin` |
| `language`          | Enum     | ✓        | `ta` \| `si` \| `en`, default `en`                 |
| `district`          | String   | ✓        | Officer scoping key                                |
| `dsDivision`        | String   |          | Divisional Secretariat                             |
| `assignedDistricts` | [String] |          | Officers only                                      |
| `department`        | String   |          | Officers only                                      |
| `isActive`          | Boolean  | ✓        | Default `true`                                     |
| `isVerified`        | Boolean  | ✓        | Phone verified                                     |
| `notificationPrefs` | Object   |          | `{ push, sms, outbreakAlerts, priceAlerts }`       |
| `pushSubscription`  | Object   |          | Web Push endpoint + keys                           |
| `lastLoginAt`       | Date     |          |                                                    |
| `deletedAt`         | Date     |          | Soft delete                                        |

**Indexes**

```js
{ phone: 1 }                        // unique
{ role: 1, district: 1 }            // officer lookup
{ district: 1, isActive: 1 }        // advisory targeting
```

**Design note.** No password field exists. Authentication is OTP-only, so there
is no credential to leak, reset, or reuse across services.

---

## 2. `otps`

Short-lived verification codes. Separated from `farmers` so that TTL expiry
operates on the whole document rather than requiring field-level cleanup.

| Field        | Type   | Notes                              |
| ------------ | ------ | ---------------------------------- |
| `phone`      | String |                                    |
| `codeHash`   | String | bcrypt — never stored in plaintext |
| `purpose`    | Enum   | `login` \| `phone_change`          |
| `attempts`   | Number | Incremented on failure             |
| `consumedAt` | Date   | Single-use enforcement             |
| `expiresAt`  | Date   | TTL index target                   |

**Indexes**

```js
{ phone: 1, purpose: 1 }
{ expiresAt: 1 }, { expireAfterSeconds: 0 }   // automatic purge
```

---

## 3. `refreshTokens`

| Field        | Type     | Notes                    |
| ------------ | -------- | ------------------------ |
| `farmerId`   | ObjectId | ref `farmers`            |
| `tokenHash`  | String   | SHA-256                  |
| `familyId`   | String   | Rotation lineage         |
| `deviceId`   | String   | Client-generated         |
| `revokedAt`  | Date     |                          |
| `replacedBy` | String   | Next token hash in chain |
| `expiresAt`  | Date     | TTL                      |

**Indexes**

```js
{ tokenHash: 1 }                    // unique
{ farmerId: 1, familyId: 1 }
{ expiresAt: 1 }, { expireAfterSeconds: 0 }
```

**Rotation and reuse detection.** Each refresh issues a new token and marks the
old one `replacedBy`. If a token that already has `replacedBy` is presented, it
has been replayed — the entire `familyId` is revoked. A legitimate client never
reuses a rotated token, so reuse implies theft.

---

## 4. `plots`

**Implemented — Day 10.** `server/src/models/plot.model.ts`.

| Field        | Type            | Required | Notes                                              |
| ------------ | --------------- | -------- | -------------------------------------------------- |
| `_id`        | String          | ✓        | **Client-generated UUID v4**, lower case           |
| `userId`     | ObjectId        | ✓        | ref `farmers`                                      |
| `name`       | String          | ✓        | 1–60 chars. "Upper field"                          |
| `crop`       | Enum            | ✓        | `crops.code` — see `CROP_CODES`                    |
| `areaAcres`  | Number          | ✓        | 0.01–1000                                          |
| `boundary`   | GeoJSON Polygon |          | Drawn on map; rings validated closed               |
| `centroid`   | GeoJSON Point   | ✓        | `[lng, lat]`. Derived from `boundary` if unsent    |
| `plantedAt`  | Date            |          | Null when nothing is in the ground                 |
| `sowingDate` | String          |          | **`YYYY-MM-DD`**. Day 12; written with `plantedAt` |
| `notes`      | String          |          | Max 500 chars                                      |
| `version`    | Number          | ✓        | Default 1; `$inc` on every write                   |
| `deletedAt`  | Date            |          | Null when live. Soft delete                        |

**Indexes**

```js
{ centroid: '2dsphere' }                       // Week 9 outbreak clustering
{ userId: 1, deletedAt: 1, updatedAt: -1 }     // the list endpoint, exactly
```

**On `_id`.** A plot's id is a UUID v4 the client generates, not an ObjectId
this server mints — the record is created offline and synced later, and a fixed
id makes the sync upsert idempotent. `docs/architecture.md`, ADR 001, has the
reasoning and the consequences; the ones visible here are that `deletedAt` is a
tombstone reserving the id rather than a nicety, and that `version` exists at
all.

This replaces the earlier `farmerId` + `clientId` pairing: `userId` is the
owner reference (matching `farmerProfiles.userId`), and the separate sync key is
gone because `_id` now _is_ the sync key.

**Why the compound index is ordered as it is.** Equality fields first
(`userId`, `deletedAt`), then the sort key (`updatedAt`, descending). The list
query walks the index in order and never sorts in memory, and because
`updatedAt` is last a paging cursor can seek straight to its position.

**Why store both `boundary` and `centroid`.** Polygon containment queries are
expensive relative to point-radius queries, and outbreak clustering only needs a
representative point. Storing the derived centroid trades a small amount of
redundancy for a substantial query cost reduction on the hottest path. The
centroid is area-weighted (shoelace), computed in `@agrisense/shared`, so the
client can show the same point before the plot has ever reached the server.

**Areas are acres, not hectares.** Matching `farmerProfiles.landSizeAcres` and
what a farmer here states their own land as. The earlier draft of this table
said `areaHectares`; having the two collections disagree on units is exactly the
bug that unit fields cause, so both are acres.

**`sowingDate` and `plantedAt` are the same fact, stored twice — for now.**
`plantedAt` is Day 10's field and is what `syncTemplateTasks` reads.
`sowingDate` is Day 12's, and is the same day stored the way §19 says a farming
day must be stored: as `YYYY-MM-DD`, because a `Date` at Colombo midnight
serialises to 18:30 the day before and puts a whole season one day early.
`POST /plots/:plotId/calendar/generate` writes both in one update, so they
cannot disagree. New code reads `sowingDate`; `plantedAt` goes when the Day 11
generator does.

**Deferred.** `district`, `dsDivision`, `soilType`, `irrigationType`,
`currentPlantingId` and `boundaryFlagged` are not implemented yet. The first two
need reverse geocoding from the centroid, `currentPlantingId` needs `plantings`
(§7), and `boundaryFlagged` belongs with the Week 6 sync conflict handling that
sets it. `boundary` carries no `2dsphere` index until a query actually needs
containment.

---

## 5. `crops` — master data

| Field            | Type       | Notes                                         |
| ---------------- | ---------- | --------------------------------------------- |
| `code`           | String     | `TOMATO`, `PADDY` — stable identifier         |
| `name`           | Locale     | `{ ta, si, en }`                              |
| `category`       | Enum       | `vegetable` \| `cereal` \| `fruit` \| `spice` |
| `durationDays`   | Number     | Sowing to harvest                             |
| `growthStages`   | [Object]   | See below                                     |
| `commonDiseases` | [ObjectId] | ref `diseases`                                |
| `imageUrl`       | String     |                                               |
| `isActive`       | Boolean    |                                               |

**`growthStages[]` element**

```
{
  order:        Number,
  name:         Locale,
  startDay:     Number,        // days after planting
  endDay:       Number,
  tasks: [{
    name:        Locale,
    dayOffset:   Number,
    type:        'irrigation' | 'fertilizer' | 'pesticide' | 'inspection',
    description: Locale
  }]
}
```

**Indexes**

```js
{ code: 1 }                         // unique
{ isActive: 1, category: 1 }
```

**Why embedded rather than a separate `growthStages` collection.** Stages are
never queried independently of their crop and never exceed a handful per
document. Splitting them would add a join to every calendar render for no
retrieval benefit.

---

## 6. `diseases` — master data

| Field                  | Type       | Notes                                    |
| ---------------------- | ---------- | ---------------------------------------- |
| `code`                 | String     | Matches ML label — `TOMATO_EARLY_BLIGHT` |
| `name`                 | Locale     |                                          |
| `scientificName`       | String     |                                          |
| `affectedCrops`        | [ObjectId] | ref `crops`                              |
| `symptoms`             | Locale     |                                          |
| `causes`               | Locale     |                                          |
| `severity`             | Enum       | `low` \| `medium` \| `high`              |
| `treatments`           | [Object]   | See below                                |
| `preventionTips`       | Locale     |                                          |
| `favourableConditions` | Object     | `{ tempMin, tempMax, humidityMin }`      |
| `referenceImages`      | [String]   |                                          |

**`treatments[]` element**

```
{
  type:            'chemical' | 'organic' | 'cultural',
  productName:     String,
  activeIngredient: String,
  dosage:          Locale,        // "2ml per litre of water"
  applicationMethod: Locale,
  intervalDays:    Number,
  phiDays:         Number,        // pre-harvest interval
  precautions:     Locale
}
```

**Indexes**

```js
{
  code: 1;
} // unique — ML label join
{
  affectedCrops: 1;
}
```

**On `favourableConditions`.** These thresholds feed the weather term in outbreak
risk scoring. A disease that requires sustained high humidity presents a
different risk in dry conditions even at equal scan density.

---

## 7. `plantings`

An instance of a crop grown on a plot during one season.

| Field                 | Type     | Required | Notes                                    |
| --------------------- | -------- | -------- | ---------------------------------------- |
| `plotId`              | ObjectId | ✓        | ref `plots`                              |
| `farmerId`            | ObjectId | ✓        | Denormalised for direct query            |
| `cropId`              | ObjectId | ✓        | ref `crops`                              |
| `clientId`            | String   | ✓        | UUID                                     |
| `plantedDate`         | Date     | ✓        |                                          |
| `expectedHarvestDate` | Date     | ✓        | Derived from `crop.durationDays`         |
| `actualHarvestDate`   | Date     |          |                                          |
| `status`              | Enum     | ✓        | `active` \| `harvested` \| `failed`      |
| `currentStage`        | Number   | ✓        | Recomputed daily                         |
| `expectedYieldKg`     | Number   |          |                                          |
| `actualYieldKg`       | Number   |          |                                          |
| `completedTasks`      | [Object] |          | `{ stageOrder, taskIndex, completedAt }` |
| `notes`               | String   |          |                                          |

**Indexes**

```js
{ plotId: 1, status: 1 }
{ farmerId: 1, status: 1 }
{ status: 1, currentStage: 1 }      // reminder job scan
{ clientId: 1 }                     // unique
```

**On denormalising `farmerId`.** It is derivable through `plotId`, but nearly
every query filters by farmer. Carrying it directly removes a lookup from the
most frequent access pattern; the cost is that plot ownership transfer would
require a backfill, which the domain does not support anyway.

---

## 8. `activities`

Append-only log of farming actions.

| Field         | Type     | Notes                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `plantingId`  | ObjectId | ref `plantings`                                                                  |
| `plotId`      | ObjectId | Denormalised                                                                     |
| `farmerId`    | ObjectId | Denormalised                                                                     |
| `clientId`    | String   | UUID                                                                             |
| `type`        | Enum     | `irrigation` \| `fertilizer` \| `pesticide` \| `weeding` \| `harvest` \| `other` |
| `performedAt` | Date     | May precede `createdAt` when logged offline                                      |
| `productName` | String   |                                                                                  |
| `quantity`    | Number   |                                                                                  |
| `unit`        | String   |                                                                                  |
| `costLKR`     | Number   |                                                                                  |
| `notes`       | String   |                                                                                  |
| `syncedAt`    | Date     |                                                                                  |

**Indexes**

```js
{ plantingId: 1, performedAt: -1 }
{ farmerId: 1, performedAt: -1 }
{ clientId: 1 }                     // unique
```

**Never updated after creation.** This is what makes the append-only merge rule
in the sync protocol safe — two devices adding activities cannot conflict,
because neither modifies what the other wrote.

---

## 9. `scans` ⭐ core collection

| Field                | Type          | Required | Notes                                                                  |
| -------------------- | ------------- | -------- | ---------------------------------------------------------------------- |
| `farmerId`           | ObjectId      | ✓        |                                                                        |
| `plotId`             | ObjectId      |          | Null for ad-hoc scans                                                  |
| `plantingId`         | ObjectId      |          |                                                                        |
| `clientId`           | String        | ✓        | UUID — sync idempotency                                                |
| `imageUrl`           | String        | ✓        | Cloudinary secure URL                                                  |
| `imagePublicId`      | String        | ✓        | For deletion / transformation                                          |
| `thumbnailUrl`       | String        |          | Retained after image expiry                                            |
| `location`           | GeoJSON Point | ✓        | Capture coordinates                                                    |
| `district`           | String        | ✓        | Reverse-geocoded                                                       |
| `capturedAt`         | Date          | ✓        | Device time                                                            |
| `status`             | Enum          | ✓        | `pending` \| `processing` \| `completed` \| `failed` \| `inconclusive` |
| **Prediction**       |               |          |                                                                        |
| `predictedDiseaseId` | ObjectId      |          | ref `diseases`                                                         |
| `predictedLabel`     | String        |          | Raw ML label                                                           |
| `confidence`         | Number        |          | 0–1                                                                    |
| `top3`               | [Object]      |          | `{ label, confidence }`                                                |
| `severity`           | Enum          |          | `low` \| `medium` \| `high`                                            |
| `gradcamUrl`         | String        |          | Heatmap overlay                                                        |
| `modelVersion`       | String        |          | e.g. `v1.2.0`                                                          |
| `inferenceMs`        | Number        |          | Latency telemetry                                                      |
| **Verification**     |               |          |                                                                        |
| `needsReview`        | Boolean       |          | Set when confidence < 0.75                                             |
| `reviewStatus`       | Enum          |          | `not_required` \| `pending` \| `confirmed` \| `corrected`              |
| `reviewedBy`         | ObjectId      |          | ref `farmers` (officer)                                                |
| `reviewedAt`         | Date          |          |                                                                        |
| `correctedDiseaseId` | ObjectId      |          | Officer's diagnosis                                                    |
| `reviewNote`         | String        |          |                                                                        |
| **Outcome**          |               |          |                                                                        |
| `treatmentApplied`   | Boolean       |          | Farmer feedback                                                        |
| `outcomeReported`    | Enum          |          | `improved` \| `unchanged` \| `worsened`                                |
| `failureReason`      | String        |          | Populated on `failed`                                                  |
| `retryCount`         | Number        |          |                                                                        |

**Indexes**

```js
{ clientId: 1 }                                   // unique — sync
{ farmerId: 1, capturedAt: -1 }                   // farmer history
{ plotId: 1, capturedAt: -1 }                     // plot timeline
{ location: '2dsphere' }                          // outbreak clustering
{ district: 1, predictedDiseaseId: 1, capturedAt: -1 }   // officer dashboard
{ reviewStatus: 1, district: 1 }                  // review queue
{ status: 1, createdAt: 1 }                       // stuck-job recovery
{ modelVersion: 1, reviewStatus: 1 }              // drift analysis
```

**Why `correctedDiseaseId` is stored separately from `predictedDiseaseId`.**
Overwriting the prediction with the correction would destroy the very signal
needed to measure model quality. Keeping both makes every officer correction a
labelled training pair and makes correction rate directly computable.

**Why `modelVersion` is denormalised onto every scan.** A diagnosis given six
months ago came from whatever model was active then. Without the version
recorded inline, no past result is reproducible or attributable.

---

## 10. `markets` — master data

| Field           | Type          | Notes                                        |
| --------------- | ------------- | -------------------------------------------- |
| `code`          | String        | `DAMBULLA`                                   |
| `name`          | Locale        |                                              |
| `type`          | Enum          | `economic_centre` \| `wholesale` \| `retail` |
| `location`      | GeoJSON Point |                                              |
| `district`      | String        |                                              |
| `operatingDays` | [Number]      | 0–6                                          |
| `isActive`      | Boolean       |                                              |

**Indexes**

```js
{ code: 1 }                         // unique
{ location: '2dsphere' }            // nearest-market queries
{ district: 1, isActive: 1 }
```

---

## 11. `marketPrices`

| Field        | Type     | Notes                                        |
| ------------ | -------- | -------------------------------------------- |
| `marketId`   | ObjectId | ref `markets`                                |
| `cropId`     | ObjectId | ref `crops`                                  |
| `date`       | Date     | Normalised to midnight UTC                   |
| `minPrice`   | Number   | LKR per kg                                   |
| `maxPrice`   | Number   |                                              |
| `modalPrice` | Number   | Most frequent — primary series input         |
| `volumeKg`   | Number   | Supply signal for the LSTM                   |
| `unit`       | String   | Default `kg`                                 |
| `source`     | Enum     | `harti` \| `manual` \| `scraped`             |
| `enteredBy`  | ObjectId | Manual entries                               |
| `isVerified` | Boolean  |                                              |
| `isOutlier`  | Boolean  | Flagged by ingestion, excluded from training |

**Indexes**

```js
{ marketId: 1, cropId: 1, date: -1 }      // unique compound — series retrieval
{ cropId: 1, date: -1 }                   // cross-market comparison
{ date: -1 }                              // daily ingestion checks
```

**On the unique compound index.** One observation per market, crop, and day.
Re-running ingestion is then an upsert rather than a duplicate — the same
idempotency principle applied to the sync protocol, applied here to a scheduled
job.

**On `isOutlier`.** A mis-keyed price of 2,000 instead of 200 would distort the
forecast for weeks. Flagging rather than deleting keeps the audit trail while
excluding the value from training.

---

## 12. `priceForecasts`

| Field            | Type     | Notes                               |
| ---------------- | -------- | ----------------------------------- |
| `cropId`         | ObjectId |                                     |
| `marketId`       | ObjectId |                                     |
| `generatedAt`    | Date     |                                     |
| `horizonDays`    | Number   | 7 or 14                             |
| `predictions`    | [Object] | `{ date, price, lower, upper }`     |
| `model`          | Enum     | `prophet` \| `lstm` \| `ensemble`   |
| `modelVersion`   | String   |                                     |
| `mape`           | Number   | Validation error at generation time |
| `trend`          | Enum     | `rising` \| `falling` \| `stable`   |
| `advisory`       | Locale   | Generated recommendation text       |
| `dataPointsUsed` | Number   | Series length — a confidence proxy  |

**Indexes**

```js
{ cropId: 1, marketId: 1, generatedAt: -1 }
{ generatedAt: -1 }                       // staleness monitoring
```

**Why `lower` and `upper` are not optional.** A point forecast presented alone
implies a precision the model does not have, to a user deciding when to sell.
Making the interval part of the stored shape prevents a UI from ever rendering
the point estimate in isolation.

---

## 13. `priceAlerts`

| Field             | Type     | Notes              |
| ----------------- | -------- | ------------------ |
| `farmerId`        | ObjectId |                    |
| `cropId`          | ObjectId |                    |
| `marketId`        | ObjectId | Null = any market  |
| `condition`       | Enum     | `above` \| `below` |
| `threshold`       | Number   | LKR                |
| `isActive`        | Boolean  |                    |
| `lastTriggeredAt` | Date     | Debounce guard     |
| `triggerCount`    | Number   |                    |

**Indexes**

```js
{ farmerId: 1, isActive: 1 }
{ cropId: 1, isActive: 1 }          // daily evaluation scan
```

---

## 14. `outbreaks`

| Field             | Type            | Notes                                                   |
| ----------------- | --------------- | ------------------------------------------------------- |
| `diseaseId`       | ObjectId        |                                                         |
| `cropId`          | ObjectId        |                                                         |
| `district`        | String          |                                                         |
| `centroid`        | GeoJSON Point   | Cluster centre                                          |
| `radiusKm`        | Number          |                                                         |
| `affectedArea`    | GeoJSON Polygon | Convex hull of member scans                             |
| `scanIds`         | [ObjectId]      | Cluster members                                         |
| `scanCount`       | Number          |                                                         |
| `firstDetectedAt` | Date            | Earliest member scan                                    |
| `lastScanAt`      | Date            |                                                         |
| `growthRate`      | Number          | Scans per day                                           |
| `riskScore`       | Number          | 0–100 composite                                         |
| `riskFactors`     | Object          | `{ density, growth, weather, cropDensity }`             |
| `severity`        | Enum            | `watch` \| `warning` \| `critical`                      |
| `status`          | Enum            | `active` \| `acknowledged` \| `contained` \| `resolved` |
| `acknowledgedBy`  | ObjectId        | Officer                                                 |
| `advisorySent`    | Boolean         |                                                         |
| `farmersNotified` | Number          |                                                         |

**Indexes**

```js
{ district: 1, status: 1, riskScore: -1 }        // officer dashboard
{ centroid: '2dsphere' }
{ diseaseId: 1, firstDetectedAt: -1 }            // historical patterns
```

**On storing `riskFactors` as a breakdown.** A composite score alone is not
actionable — an officer needs to know whether a cluster scored highly because of
density or because conditions favour spread. Persisting the components makes the
score explainable rather than oracular.

---

## 15. `advisories`

| Field            | Type          | Notes                                             |
| ---------------- | ------------- | ------------------------------------------------- |
| `outbreakId`     | ObjectId      | Null for general advisories                       |
| `sentBy`         | ObjectId      | Officer                                           |
| `title`          | Locale        |                                                   |
| `message`        | Locale        |                                                   |
| `targetType`     | Enum          | `district` \| `ds_division` \| `radius` \| `crop` |
| `targetDistrict` | String        |                                                   |
| `targetCentroid` | GeoJSON Point | Radius targeting                                  |
| `targetRadiusKm` | Number        |                                                   |
| `targetCropIds`  | [ObjectId]    |                                                   |
| `priority`       | Enum          | `info` \| `warning` \| `urgent`                   |
| `recipientCount` | Number        |                                                   |
| `deliveredCount` | Number        |                                                   |
| `readCount`      | Number        |                                                   |
| `channels`       | [String]      | `push`, `sms`, `in_app`                           |
| `expiresAt`      | Date          |                                                   |

**Indexes**

```js
{ targetDistrict: 1, createdAt: -1 }
{ sentBy: 1, createdAt: -1 }
{ expiresAt: 1 }
```

---

## 16. `syncLog`

Idempotency ledger for client mutations.

| Field                | Type     | Notes                                        |
| -------------------- | -------- | -------------------------------------------- |
| `clientId`           | String   | UUID from client                             |
| `farmerId`           | ObjectId |                                              |
| `deviceId`           | String   |                                              |
| `entity`             | String   | `scan` \| `plot` \| `activity` \| `planting` |
| `operation`          | Enum     | `create` \| `update` \| `delete`             |
| `serverId`           | ObjectId | Resulting document                           |
| `result`             | Enum     | `applied` \| `conflict` \| `rejected`        |
| `conflictResolution` | String   | Rule applied                                 |
| `appliedAt`          | Date     |                                              |

**Indexes**

```js
{ clientId: 1 }                                   // unique — the whole point
{ farmerId: 1, appliedAt: -1 }
{ appliedAt: 1 }, { expireAfterSeconds: 7776000 } // 90-day TTL
```

**This collection is what makes retries safe.** A mutation arriving twice — from
a client retry, a duplicated Background Sync event, or a user reinstalling —
finds its `clientId` already recorded and is acknowledged without reapplication.
Without it, a farmer with flaky connectivity would accumulate duplicate scans.

**Why a 90-day TTL is sufficient.** A client that has not synced in 90 days
performs a full resync rather than a delta, so ledger entries older than that
have no remaining purpose.

---

## 17. `modelMetrics`

Drift and performance tracking.

| Field                    | Type   | Notes                       |
| ------------------------ | ------ | --------------------------- |
| `modelType`              | Enum   | `disease` \| `forecast`     |
| `modelVersion`           | String |                             |
| `periodStart`            | Date   |                             |
| `periodEnd`              | Date   |                             |
| `totalPredictions`       | Number |                             |
| `avgConfidence`          | Number |                             |
| `lowConfidenceRate`      | Number | Proportion below threshold  |
| `reviewedCount`          | Number |                             |
| `correctedCount`         | Number |                             |
| `correctionRate`         | Number | **Primary drift signal**    |
| `classDistribution`      | Object | Predictions per class       |
| `perClassCorrectionRate` | Object | Which classes degrade first |

**Indexes**

```js
{ modelType: 1, modelVersion: 1, periodStart: -1 }
```

**Why per-class correction rate matters more than the aggregate.** Overall
accuracy can hold steady while one class quietly collapses — a disease whose
field presentation differs most from the training imagery. The aggregate hides
that; the breakdown surfaces it.

---

## 18. `farmerProfiles`

The agronomic detail behind a farmer's identity, extending §1 `farmers`.

Numbered last rather than beside `farmers`, where it belongs conceptually,
because renumbering sixteen sections would invalidate every cross-reference
that already points at them.

| Field               | Type          | Required | Notes                                                                 |
| ------------------- | ------------- | -------- | --------------------------------------------------------------------- |
| `userId`            | ObjectId      | ✓        | ref `farmers`, unique — one profile per farmer                        |
| `fullName`          | String        | ✓        | 2–100 chars; mirrors `farmers.name`                                   |
| `district`          | Enum          | ✓        | `Anuradhapura` \| `Polonnaruwa` \| `Kurunegala`                       |
| `gnDivision`        | String        | ✓        | Grama Niladhari — one level below `farmers.dsDivision`                |
| `location`          | GeoJSON Point | ✓        | Homestead or main holding                                             |
| `landSizeAcres`     | Number        | ✓        | 0.1–1000; acres, unlike `plots.areaHectares`                          |
| `primaryCrops`      | [Enum]        | ✓        | ≥ 1 of `crops.code` — `PADDY`, `TOMATO`, `CHILLI`, `ONION`, `BRINJAL` |
| `preferredLanguage` | Enum          | ✓        | `ta` \| `si` \| `en`; mirrors `farmers.language`                      |

**Indexes**

```js
{
  userId: 1;
} // unique — one profile per farmer
{
  location: '2dsphere';
} // outbreak clustering (DBSCAN)
{
  district: 1;
} // officer dashboard pre-filter
```

**Why this is not part of `farmers`.** The two are written on different
occasions and read on different paths. `authenticate` reads the farmer document
on every authenticated request; this is filled in once after sign-up and edited
rarely. Keeping the land, location and crop fields out of the hot document
keeps that per-request read small.

**On the three duplicated fields.** `fullName`, `district` and
`preferredLanguage` deliberately mirror `farmers.name`, `.district` and
`.language`. This collection is authoritative and the service writes through to
the farmer record on every save, because officer district-scoping and
`/auth/me` read the farmer copy — a farmer who corrected their district here
would otherwise go on being scoped, and advised, by the old one.

**Why `district` and `primaryCrops` are enums when §1 and §4 use strings.**
District is the scoping key for every officer query and the grouping key for
outbreak clustering, so a profile saved as "Anuradapura" would silently drop
out of both. `farmers.district` and `plots.district` predate the list; widening
them to it is a migration, not a schema change. `primaryCrops` holds
`crops.code` rather than `crops` ObjectIds because it is a farmer's declaration
of what they grow, not a reference to a master-data row: it has to be
validatable on the client, offline, where no ObjectId means anything.

---

## 19. `calendarTasks`

**Implemented — Day 11.** `server/src/models/calendarTask.model.ts`.

One thing to do, on one plot, on one day. Generated from the crop calendar when
a plot is planted, or written by the farmer.

| Field               | Type     | Required | Notes                                                                                 |
| ------------------- | -------- | -------- | ------------------------------------------------------------------------------------- |
| `_id`               | String   | ✓        | **UUID v4**, lower case — client's, or the generator's                                |
| `userId`            | ObjectId | ✓        | ref `farmers`                                                                         |
| `plotId`            | String   | ✓        | ref `plots` — a UUID, because `plots._id` is one                                      |
| `type`              | Enum     | ✓        | `sowing` \| `fertilising` \| `irrigation` \| `pest_control` \| `weeding` \| `harvest` |
| `title`             | String   | ✓        | 1–100. Free text, or an **i18n key** — see below                                      |
| `notes`             | String   |          | Max 500. Free text, or the description's i18n key                                     |
| `dueDate`           | String   | ✓        | **`YYYY-MM-DD`**, not a Date — see below                                              |
| `completedOn`       | String   |          | `YYYY-MM-DD`, null while outstanding                                                  |
| `status`            | Enum     | ✓        | **Day 12.** `pending` \| `done` \| `skipped`                                          |
| `completedAt`       | Date     |          | **Day 12.** The instant the task left `pending`                                       |
| `isUserEdited`      | Boolean  | ✓        | **Day 12.** `true` once a farmer has touched it                                       |
| `generationBatchId` | String   |          | **Day 12.** UUID v4 of the run that made it; null on manual                           |
| `source`            | Enum     | ✓        | `template` \| `manual`. Server-owned                                                  |
| `reminderAt`        | String   |          | ISO 8601 instant. **Reserved for Week 9**; nothing reads it                           |
| `version`           | Number   | ✓        | Default 1; `$inc` on every write                                                      |
| `deletedAt`         | Date     |          | Null when live. Soft delete                                                           |

**Indexes**

```js
{ userId: 1, plotId: 1, deletedAt: 1, dueDate: 1 }   // one plot's calendar
{ userId: 1, deletedAt: 1, dueDate: 1 }              // /calendar/upcoming, /calendar/today
{ plotId: 1, generationBatchId: 1 }                  // sparse — the generator
```

**Why days are strings.** A farming task happens on a day; "top-dress on 12
June" has no hour on it and never will. Sri Lanka is UTC+05:30, so a `Date` at
local midnight stores as 18:30 the previous day and every task in the app
shifts back one. The half-hour offset rules out the usual escapes too:
truncating to midnight in the server's zone moves some values and not others,
which is worse than moving all of them because it looks correct in testing.
`YYYY-MM-DD` sorts lexically in the order it sorts chronologically, so `$gte`
/`$lte` ranges and index sorts work on the string unchanged.

**Why two indexes when the brief names one.** The first cannot serve
`/calendar/upcoming`, which names no plot: `plotId` sits in the middle of it, so
an unconstrained query gets `userId` as its only usable prefix and leaves the
date range and the sort to be done in memory over every task the farmer owns.

**`/calendar/today` has no index of its own, and that is a measurement rather
than an omission.** `explain()` on the pipeline in
`server/src/modules/calendar/calendarToday.service.ts` picks `owner_live_due`:

```
SORT < FETCH < IXSCAN(owner_live_due)
  indexBounds: userId [eq], deletedAt [null], dueDate ["", <today + 7>]
```

A `{ userId, deletedAt, status, dueDate }` index was written, measured and
removed again. The pipeline's `$match` carries an `$or` — the `today` bucket
wants every status, while `overdue` and `next7` want only `pending` — so one
branch leaves `status` unconstrained and the planner cannot use it as an index
prefix. It appeared only in `rejectedPlans`, both as written and with both
branches rewritten to name `status` explicitly. An index no plan selects is
write amplification on every task for nothing.

What makes the residual filter acceptable is the bound: the scan covers one
farmer's tasks up to the seven-day horizon, which is tens to low hundreds of
documents. The backward end is deliberately unbounded, because an overdue task
is unbounded by definition — a spray missed three weeks ago is still missed.
`calendarToday.integration.test.ts` asserts on the _winning_ plan, not on the
explain document as a whole; the first version of that assertion searched the
raw JSON for an index name, which passes on a rejected plan and would have let
this regress silently.

**The generator's index is sparse.** `{ plotId, generationBatchId }` answers one
question — "has this batch already run on this plot?" — and finds the previous
batch's tasks when a new batch supersedes them. Sparse because a manual task has
no batch, and indexing every null would be most of the collection for a key
nobody looks up.

**`status` did not replace `completedOn`; it joined it.** `completedOn` could
already say done or not-done. What it had no way to say is that a farmer looked
at a task and decided against it, and a skipped task is neither outstanding nor
finished. The two are written together and never independently:

| `status`  | `completedAt`         | `completedOn`       |
| --------- | --------------------- | ------------------- |
| `pending` | `null`                | `null`              |
| `done`    | the instant they said | the day it was done |
| `skipped` | the instant they said | `null`              |

`completedAt` is an instant and `completedOn` is a day because they answer
different questions: when the farmer said so, and when the work happened. A
farmer ticking off Tuesday's spray on Thursday evening produces two different
and both correct values. `skipped` has no day, because there is no day on which
the work was carried out.

**`isUserEdited` is a stronger guarantee than `completedOn`.** Regeneration
already spared finished work; it did not spare a task whose date or title the
farmer had corrected and not yet done. That task is theirs now, even though the
generator made it. Both the Day 11 `syncTemplateTasks` and the Day 12
generator carry the flag in their delete filter.

**`title` is sometimes a key.** A template task stores
`calendar.task.paddy.topDressing1.title`, not a sentence, because the server has
no business choosing which of three languages to write a farmer's calendar in
and the farmer may switch language afterwards. `source` is what tells a client
whether to translate the field or print it. The agronomy behind those keys is
`server/src/data/crop-calendar-templates.json`, deliberately data rather than
code so an agronomist can correct it.

**`source` and `completedOn` are not client-writable through `PUT`.** A client
that could claim `template` could hide a task from regeneration; and completion
is lifecycle state, like `version` and `deletedAt`, so a replayed offline edit
cannot silently un-tick finished work. `PATCH` may set `completedOn` explicitly,
including to `null`. See `docs/api-spec.md`.

**Regeneration is narrow.** When a plot's `plantedAt` moves, outstanding
`template` tasks for that plot are tombstoned and rebuilt from the new day.
Manual tasks are never touched, and neither is anything with a `completedOn` —
a tick records something that happened in a field, and tidying up a plan must
not delete history.

**Relationship to §7 `plantings` and §8 `activities`.** Neither is implemented.
When they are, `plantings` becomes the season a task belongs to and `activities`
the log of work actually done; this collection stays the _plan_. The two type
vocabularies are deliberately separate — `activities.type` uses `fertilizer`
and `pesticide` for a record, `calendarTasks.type` uses `fertilising` and
`pest_control` for an intention — and neither should be quietly widened into
the other.

---

## 20. `cropStageTemplates` — reference data

**Implemented — Day 12.** `server/src/models/cropStageTemplate.model.ts`,
seeded by `server/src/seed/cropStageTemplates.ts` (`npm run seed:templates`).

One document is one growth stage of one crop: "PADDY, tillering, days 14–39,
and these three things to do in it". A plot's calendar is the stages for its
crop laid end to end from the day it was sown.

| Field             | Type     | Required | Notes                                           |
| ----------------- | -------- | -------- | ----------------------------------------------- |
| `_id`             | String   | ✓        | **Server-minted UUID v4** — see below           |
| `cropId`          | Enum     | ✓        | `CROP_CODES`, matching `plots.crop`             |
| `stageName`       | Locale   | ✓        | `{ ta, si, en }`. Displayed as-is               |
| `startOffsetDays` | Number   | ✓        | Days from the sowing date to the stage's start  |
| `durationDays`    | Number   | ✓        | 1–730                                           |
| `tasks`           | [Object] | ✓        | See below. May be empty                         |
| `isActive`        | Boolean  | ✓        | Default `true`. Never deleted, only deactivated |
| `version`         | Number   | ✓        | Bumped only when the agronomy actually changes  |

**`tasks[]` element**

```
{
  taskType:   'sowing' | 'fertilising' | 'irrigation' | 'pest_control' | 'weeding' | 'harvest',
  offsetDays: Number,      // from the SOWING DATE, not from the stage start
  titleKey:   String,      // i18n key, never a sentence
  isCritical: Boolean
}
```

**Indexes**

```js
{ cropId: 1, startOffsetDays: 1 }         // the generator's read, in season order
{ cropId: 1, 'stageName.en': 1 }          // unique — the seed's upsert key
```

**Why the `_id` is a UUID and not an ObjectId.** The convention above gives
ObjectIds to everything the farmer does not author, and this is a deliberate
exception. These rows are seeded independently into every environment, and an
id the seed can compute rather than discover is what keeps a reference to a
stage working across a dump, a restore and a fresh developer laptop. Nothing
about it is client-generated; no request body can set it.

**Why the name index is unique.** It is the seed's upsert key, and "idempotent"
has to survive two seeds racing. Without the constraint both miss on the find,
both insert, and the crop quietly grows a duplicate stage that the generator
then emits twice.

**`offsetDays` is measured from the sowing date, not from the stage start.**
Both readings are defensible and only one can be right, so it is stated in the
model and asserted by the seed. A task at `offsetDays: 21` inside a stage
running 14–39 falls on sowing + 21 days, which is day 8 of that stage. The
generator then writes `addDays(sowingDate, offsetDays)` with no stage
arithmetic in it, and a stage whose boundaries are corrected does not silently
move the tasks inside it.

**Relationship to `crop-calendar-templates.json`.** The JSON file is Day 11's
flat list of activities per crop and still drives `syncTemplateTasks`. This
collection is the same agronomy with the growth stage put back in. The seed
refuses to run if the two have drifted — it compares
`dayOffset:type:titleKey` on both sides, per crop — because a farmer can hold a
calendar generated from one and a stage bar drawn from the other, and a day
corrected in one and not the other is invisible in testing and confusing in a
field. It also checks that each crop's stages tile its season exactly, with no
gap the stage bar cannot label and no overlap putting a plot in two stages at
once.

**Nothing is ever deleted.** A calendar generated last season came from a row;
removing it would make that calendar unexplainable. A corrected stage is
updated in place, with `version` incremented, under the same `_id`.

**It ships unreviewed.** Every `startOffsetDays`, `durationDays` and
`isCritical` is indicative dry-zone (Anuradhapura/Polonnaruwa) timing compiled
from general DOA guidance, and needs an agronomist to confirm or correct it
before release. The seed file says so in its own header.

---

## Aggregation Pipelines

### Officer dashboard — disease counts by district

```js
[
  {
    $match: {
      district: officerDistrict,
      status: 'completed',
      capturedAt: { $gte: fourteenDaysAgo },
    },
  },
  {
    $group: {
      _id: '$predictedDiseaseId',
      count: { $sum: 1 },
      avgConfidence: { $avg: '$confidence' },
      lastSeen: { $max: '$capturedAt' },
    },
  },
  {
    $lookup: {
      from: 'diseases',
      localField: '_id',
      foreignField: '_id',
      as: 'disease',
    },
  },
  { $sort: { count: -1 } },
];
```

### Model drift — correction rate by month

```js
[
  { $match: { reviewStatus: { $in: ['confirmed', 'corrected'] } } },
  {
    $group: {
      _id: {
        month: { $dateToString: { format: '%Y-%m', date: '$capturedAt' } },
        version: '$modelVersion',
      },
      reviewed: { $sum: 1 },
      corrected: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'corrected'] }, 1, 0] } },
    },
  },
  { $addFields: { correctionRate: { $divide: ['$corrected', '$reviewed'] } } },
  { $sort: { '_id.month': 1 } },
];
```

### Nearby markets with net price

```js
[
  {
    $geoNear: {
      near: plotCentroid,
      distanceField: 'distanceM',
      maxDistance: 100000,
      spherical: true,
    },
  },
  {
    $lookup: {
      from: 'marketPrices',
      let: { mId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$marketId', '$$mId'] },
                { $eq: ['$cropId', cropId] },
                { $gte: ['$date', yesterday] },
              ],
            },
          },
        },
        { $sort: { date: -1 } },
        { $limit: 1 },
      ],
      as: 'price',
    },
  },
  { $unwind: '$price' },
  {
    $addFields: {
      transportCost: {
        $multiply: [{ $divide: ['$distanceM', 1000] }, transportRatePerKm, quantityKg],
      },
      netPrice: {
        $subtract: [
          { $multiply: ['$price.modalPrice', quantityKg] },
          { $multiply: [{ $divide: ['$distanceM', 1000] }, transportRatePerKm, quantityKg] },
        ],
      },
    },
  },
  { $sort: { netPrice: -1 } },
];
```

---

## Seed Data Requirements

| Collection           | Records | Source                                       |
| -------------------- | ------- | -------------------------------------------- |
| `crops`              | 10      | Manual, trilingual                           |
| `diseases`           | 15      | Matched to ML label set                      |
| `markets`            | 6       | Sri Lankan economic centres                  |
| `marketPrices`       | ~2,000  | 12 months × 5 crops × 4 markets              |
| `farmers`            | 20      | Generated demo accounts                      |
| `plots`              | 40      | Distributed across 3 districts               |
| `scans`              | 200     | Seeded to trigger outbreak clustering        |
| `cropStageTemplates` | 25      | 5 stages × 5 crops. `npm run seed:templates` |

**Seed the scan data deliberately.** Cluster a subset within a 5 km radius over a
7-day window so that outbreak detection has something to find during a
demonstration. A correct algorithm with no qualifying data looks identical to a
broken one.

---

## Migration Strategy

| Change             | Approach                                     |
| ------------------ | -------------------------------------------- |
| Add optional field | No migration; absent reads as undefined      |
| Add required field | Backfill script with default, then enforce   |
| Rename field       | Dual-write, backfill, cut over, drop         |
| Change type        | New field, migrate, drop old                 |
| Add index          | Build in background on the deployed instance |

Migration scripts live in `server/src/migrations/`, named `NNN_description.ts`,
applied in order and recorded in a `migrations` collection.
