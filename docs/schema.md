# AgriSense — Database Schema

**Database:** MongoDB 6  
**ODM:** Mongoose  
**Version:** 1.0

---

## Conventions

| Convention | Rule |
|---|---|
| Collection names | lowercase plural (`farmers`, `scans`) |
| Field names | camelCase |
| Timestamps | `createdAt`, `updatedAt` — Mongoose `{ timestamps: true }` |
| Soft delete | `deletedAt: Date \| null` on user-owned entities |
| References | `ObjectId` with explicit `ref` |
| Geospatial | GeoJSON, `2dsphere` index |
| Translations | Embedded object keyed by locale: `{ ta, si, en }` |
| Sync key | `clientId: String` (UUID v4) on client-writable entities |

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

| Field | Type | Required | Notes |
|---|---|---|---|
| `_id` | ObjectId | ✓ | |
| `phone` | String | ✓ | E.164, unique |
| `name` | String | ✓ | |
| `role` | Enum | ✓ | `farmer` \| `officer` \| `market_admin` \| `admin` |
| `language` | Enum | ✓ | `ta` \| `si` \| `en`, default `en` |
| `district` | String | ✓ | Officer scoping key |
| `dsDivision` | String | | Divisional Secretariat |
| `assignedDistricts` | [String] | | Officers only |
| `department` | String | | Officers only |
| `isActive` | Boolean | ✓ | Default `true` |
| `isVerified` | Boolean | ✓ | Phone verified |
| `notificationPrefs` | Object | | `{ push, sms, outbreakAlerts, priceAlerts }` |
| `pushSubscription` | Object | | Web Push endpoint + keys |
| `lastLoginAt` | Date | | |
| `deletedAt` | Date | | Soft delete |

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

| Field | Type | Notes |
|---|---|---|
| `phone` | String | |
| `codeHash` | String | bcrypt — never stored in plaintext |
| `purpose` | Enum | `login` \| `phone_change` |
| `attempts` | Number | Incremented on failure |
| `consumedAt` | Date | Single-use enforcement |
| `expiresAt` | Date | TTL index target |

**Indexes**
```js
{ phone: 1, purpose: 1 }
{ expiresAt: 1 }, { expireAfterSeconds: 0 }   // automatic purge
```

---

## 3. `refreshTokens`

| Field | Type | Notes |
|---|---|---|
| `farmerId` | ObjectId | ref `farmers` |
| `tokenHash` | String | SHA-256 |
| `familyId` | String | Rotation lineage |
| `deviceId` | String | Client-generated |
| `revokedAt` | Date | |
| `replacedBy` | String | Next token hash in chain |
| `expiresAt` | Date | TTL |

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

| Field | Type | Required | Notes |
|---|---|---|---|
| `farmerId` | ObjectId | ✓ | ref `farmers` |
| `clientId` | String | ✓ | UUID, sync idempotency |
| `name` | String | ✓ | "Upper field" |
| `boundary` | GeoJSON Polygon | | Drawn on map |
| `centroid` | GeoJSON Point | ✓ | Derived; used for radius queries |
| `areaHectares` | Number | ✓ | Computed from boundary |
| `district` | String | ✓ | Reverse-geocoded from centroid |
| `dsDivision` | String | | |
| `soilType` | Enum | | `clay` \| `loam` \| `sandy` \| `laterite` |
| `irrigationType` | Enum | | `rainfed` \| `canal` \| `well` \| `drip` |
| `currentPlantingId` | ObjectId | | ref `plantings`, denormalised |
| `boundaryFlagged` | Boolean | | Set on sync conflict, pending officer review |
| `deletedAt` | Date | | |

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

| Field | Type | Notes |
|---|---|---|
| `code` | String | `TOMATO`, `PADDY` — stable identifier |
| `name` | Locale | `{ ta, si, en }` |
| `category` | Enum | `vegetable` \| `cereal` \| `fruit` \| `spice` |
| `durationDays` | Number | Sowing to harvest |
| `growthStages` | [Object] | See below |
| `commonDiseases` | [ObjectId] | ref `diseases` |
| `imageUrl` | String | |
| `isActive` | Boolean | |

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

| Field | Type | Notes |
|---|---|---|
| `code` | String | Matches ML label — `TOMATO_EARLY_BLIGHT` |
| `name` | Locale | |
| `scientificName` | String | |
| `affectedCrops` | [ObjectId] | ref `crops` |
| `symptoms` | Locale | |
| `causes` | Locale | |
| `severity` | Enum | `low` \| `medium` \| `high` |
| `treatments` | [Object] | See below |
| `preventionTips` | Locale | |
| `favourableConditions` | Object | `{ tempMin, tempMax, humidityMin }` |
| `referenceImages` | [String] | |

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
{ code: 1 }                         // unique — ML label join
{ affectedCrops: 1 }
```

**On `favourableConditions`.** These thresholds feed the weather term in outbreak
risk scoring. A disease that requires sustained high humidity presents a
different risk in dry conditions even at equal scan density.

---

## 7. `plantings`

An instance of a crop grown on a plot during one season.

| Field | Type | Required | Notes |
|---|---|---|---|
| `plotId` | ObjectId | ✓ | ref `plots` |
| `farmerId` | ObjectId | ✓ | Denormalised for direct query |
| `cropId` | ObjectId | ✓ | ref `crops` |
| `clientId` | String | ✓ | UUID |
| `plantedDate` | Date | ✓ | |
| `expectedHarvestDate` | Date | ✓ | Derived from `crop.durationDays` |
| `actualHarvestDate` | Date | | |
| `status` | Enum | ✓ | `active` \| `harvested` \| `failed` |
| `currentStage` | Number | ✓ | Recomputed daily |
| `expectedYieldKg` | Number | | |
| `actualYieldKg` | Number | | |
| `completedTasks` | [Object] | | `{ stageOrder, taskIndex, completedAt }` |
| `notes` | String | | |

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

| Field | Type | Notes |
|---|---|---|
| `plantingId` | ObjectId | ref `plantings` |
| `plotId` | ObjectId | Denormalised |
| `farmerId` | ObjectId | Denormalised |
| `clientId` | String | UUID |
| `type` | Enum | `irrigation` \| `fertilizer` \| `pesticide` \| `weeding` \| `harvest` \| `other` |
| `performedAt` | Date | May precede `createdAt` when logged offline |
| `productName` | String | |
| `quantity` | Number | |
| `unit` | String | |
| `costLKR` | Number | |
| `notes` | String | |
| `syncedAt` | Date | |

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

| Field | Type | Required | Notes |
|---|---|---|---|
| `farmerId` | ObjectId | ✓ | |
| `plotId` | ObjectId | | Null for ad-hoc scans |
| `plantingId` | ObjectId | | |
| `clientId` | String | ✓ | UUID — sync idempotency |
| `imageUrl` | String | ✓ | Cloudinary secure URL |
| `imagePublicId` | String | ✓ | For deletion / transformation |
| `thumbnailUrl` | String | | Retained after image expiry |
| `location` | GeoJSON Point | ✓ | Capture coordinates |
| `district` | String | ✓ | Reverse-geocoded |
| `capturedAt` | Date | ✓ | Device time |
| `status` | Enum | ✓ | `pending` \| `processing` \| `completed` \| `failed` \| `inconclusive` |
| **Prediction** | | | |
| `predictedDiseaseId` | ObjectId | | ref `diseases` |
| `predictedLabel` | String | | Raw ML label |
| `confidence` | Number | | 0–1 |
| `top3` | [Object] | | `{ label, confidence }` |
| `severity` | Enum | | `low` \| `medium` \| `high` |
| `gradcamUrl` | String | | Heatmap overlay |
| `modelVersion` | String | | e.g. `v1.2.0` |
| `inferenceMs` | Number | | Latency telemetry |
| **Verification** | | | |
| `needsReview` | Boolean | | Set when confidence < 0.75 |
| `reviewStatus` | Enum | | `not_required` \| `pending` \| `confirmed` \| `corrected` |
| `reviewedBy` | ObjectId | | ref `farmers` (officer) |
| `reviewedAt` | Date | | |
| `correctedDiseaseId` | ObjectId | | Officer's diagnosis |
| `reviewNote` | String | | |
| **Outcome** | | | |
| `treatmentApplied` | Boolean | | Farmer feedback |
| `outcomeReported` | Enum | | `improved` \| `unchanged` \| `worsened` |
| `failureReason` | String | | Populated on `failed` |
| `retryCount` | Number | | |

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

| Field | Type | Notes |
|---|---|---|
| `code` | String | `DAMBULLA` |
| `name` | Locale | |
| `type` | Enum | `economic_centre` \| `wholesale` \| `retail` |
| `location` | GeoJSON Point | |
| `district` | String | |
| `operatingDays` | [Number] | 0–6 |
| `isActive` | Boolean | |

**Indexes**
```js
{ code: 1 }                         // unique
{ location: '2dsphere' }            // nearest-market queries
{ district: 1, isActive: 1 }
```

---

## 11. `marketPrices`

| Field | Type | Notes |
|---|---|---|
| `marketId` | ObjectId | ref `markets` |
| `cropId` | ObjectId | ref `crops` |
| `date` | Date | Normalised to midnight UTC |
| `minPrice` | Number | LKR per kg |
| `maxPrice` | Number | |
| `modalPrice` | Number | Most frequent — primary series input |
| `volumeKg` | Number | Supply signal for the LSTM |
| `unit` |
