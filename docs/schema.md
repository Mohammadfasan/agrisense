# AgriSense — Database Schema

**Database:** MongoDB 6  
**ODM:** Mongoose  
**Version:** 1.0

---

## Conventions

| Convention       | Rule                                                       |
| ---------------- | ---------------------------------------------------------- |
| Collection names | lowercase plural (`farmers`, `scans`)                      |
| Field names      | camelCase                                                  |
| Timestamps       | `createdAt`, `updatedAt` — Mongoose `{ timestamps: true }` |
| Soft delete      | `deletedAt: Date \| null` on user-owned entities           |
| References       | `ObjectId` with explicit `ref`                             |
| Geospatial       | GeoJSON, `2dsphere` index                                  |
| Translations     | Embedded object keyed by locale: `{ ta, si, en }`          |
| Sync key         | `clientId: String` (UUID v4) on client-writable entities   |

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

| Field               | Type            | Required | Notes                                        |
| ------------------- | --------------- | -------- | -------------------------------------------- |
| `farmerId`          | ObjectId        | ✓        | ref `farmers`                                |
| `clientId`          | String          | ✓        | UUID, sync idempotency                       |
| `name`              | String          | ✓        | "Upper field"                                |
| `boundary`          | GeoJSON Polygon |          | Drawn on map                                 |
| `centroid`          | GeoJSON Point   | ✓        | Derived; used for radius queries             |
| `areaHectares`      | Number          | ✓        | Computed from boundary                       |
| `district`          | String          | ✓        | Reverse-geocoded from centroid               |
| `dsDivision`        | String          |          |                                              |
| `soilType`          | Enum            |          | `clay` \| `loam` \| `sandy` \| `laterite`    |
| `irrigationType`    | Enum            |          | `rainfed` \| `canal` \| `well` \| `drip`     |
| `currentPlantingId` | ObjectId        |          | ref `plantings`, denormalised                |
| `boundaryFlagged`   | Boolean         |          | Set on sync conflict, pending officer review |
| `deletedAt`         | Date            |          |                                              |

**Indexes**

```js
{ farmerId: 1, deletedAt: 1 }
{ centroid: '2dsphere' }            // radius / outbreak proximity
{ boundary: '2dsphere' }            // containment queries
{ clientId: 1 }                     // unique — sync
{ district: 1 }
```

**Why store both `boundary` and `centroid`.** Polygon containment queries are
expensive relative to point-radius queries, and outbreak clustering only needs a
representative point. Storing the derived centroid trades a small amount of
redundancy for a substantial query cost reduction on the hottest path.

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
{ userId: 1 }                       // unique — one profile per farmer
{ location: '2dsphere' }            // outbreak clustering (DBSCAN)
{ district: 1 }                     // officer dashboard pre-filter
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

| Collection     | Records | Source                                |
| -------------- | ------- | ------------------------------------- |
| `crops`        | 10      | Manual, trilingual                    |
| `diseases`     | 15      | Matched to ML label set               |
| `markets`      | 6       | Sri Lankan economic centres           |
| `marketPrices` | ~2,000  | 12 months × 5 crops × 4 markets       |
| `farmers`      | 20      | Generated demo accounts               |
| `plots`        | 40      | Distributed across 3 districts        |
| `scans`        | 200     | Seeded to trigger outbreak clustering |

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
