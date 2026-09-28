import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CROP_CODES, type CropCode, type GeoPoint } from '@shared/types';

/**
 * `scans` — one leaf photo a farmer took, and what the model made of it.
 *
 * **Client-generated UUID v4 `_id`, like `plots`.** A farmer with no signal
 * takes the photo, the phone stores it under an id it already has, and the
 * upload later lands on that id. A replayed upload finds the scan that is
 * already there instead of creating a second one.
 *
 * **Unlike a plot, a scan is written once.** The photo is a fact about a
 * moment; it is never replaced. What changes is `status`, as the diagnosis
 * arrives:
 *
 *   pending ──ML 200, confident──▶ diagnosed
 *   pending ──ML 200, not sure──▶ escalated   (an officer reviews it)
 *   pending ──ML 400──────────────▶ rejected    (unusable photo; retake)
 *   pending ──ML down / timeout──▶ pending     (attempts++; retried later)
 *
 * `diagnosis` keeps the model's full answer even when escalated. The farmer
 * API hides the class in that case (`scan.presenter`), but officers and the
 * Week 9 drift monitoring need what the model actually thought.
 *
 * `crop` is copied from the plot at capture time, not looked up later: a plot
 * can be replanted with a different crop next season, and a scan must keep
 * describing the crop that was in the photo.
 *
 * `capturedAt` is an instant (a `Date`), not a `YYYY-MM-DD` day. The day-string
 * rule in `docs/schema.md` is for farming days such as a sowing date; this is
 * the moment the shutter closed, and it may be hours before the upload.
 *
 * `nextAttemptAt` drives the retry sweep (`scan.service`): it says when a
 * pending scan is due, and a worker pushes it forward as a lease when it
 * claims the scan, so two workers never take the same one.
 */

/** Mirrors `plotIdSchema`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const SCAN_STATUSES = ['pending', 'diagnosed', 'escalated', 'rejected'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface ScanPhoto {
  /** Where `PhotoStorage` put it. Never a filesystem path from a request. */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  /** Detects a replayed upload that carries a DIFFERENT photo under the same id. */
  sha256: string;
}

export interface ScanCandidate {
  classKey: string;
  probability: number;
}

export interface ScanHeatmap {
  /** rows x cols, 0..1; row 0 is the top of the photo. */
  grid: number[][];
  /** [left, top, right, bottom] of the photo the grid covers, as fractions. */
  region: number[];
}

export interface ScanDiagnosis {
  classKey: string;
  isHealthy: boolean;
  confidence: number;
  requiredConfidence: number;
  top: ScanCandidate[];
  /** Only for disease classes. */
  heatmap: ScanHeatmap | null;
  modelVersion: string;
  inferenceMs: number;
  diagnosedAt: Date;
}

export interface Scan {
  /** Client-generated UUID v4, lower case. */
  _id: string;
  /** ref `farmers`. Never read from a request body. */
  userId: Types.ObjectId;
  /** The plot the photo was taken in, if the farmer chose one. */
  plotId: string | null;
  /** Copied from the plot at capture time. */
  crop?: CropCode;
  /** Week 9 outbreak clustering. From the device, or the plot's centroid. */
  location?: GeoPoint;
  capturedAt: Date;
  photo: ScanPhoto;
  status: ScanStatus;
  diagnosis: ScanDiagnosis | null;
  /** Safe-to-show reason when `status` is `rejected`. */
  rejectReason: string | null;
  /** Diagnosis attempts made, successful or not. */
  attempts: number;
  /** Last failure talking to the ML service. For logs and the retry sweep. */
  lastError: string | null;
  /**
   * When the retry sweep may next try this scan. Also the claim lease: a
   * worker pushes it forward as it takes the scan, so no other worker picks
   * it up meanwhile. `null` once decided, or after the last attempt.
   */
  nextAttemptAt: Date | null;
  /** Incremented on every write the farmer can see, including the soft delete. */
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ScanDocument = HydratedDocument<Scan>;

const pointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => value.length === 2,
        message: 'coordinates must be [longitude, latitude]',
      },
    },
  },
  { _id: false },
);

const photoSchema = new Schema<ScanPhoto>(
  {
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
  },
  { _id: false },
);

const candidateSchema = new Schema<ScanCandidate>(
  {
    classKey: { type: String, required: true },
    probability: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const heatmapSchema = new Schema<ScanHeatmap>(
  {
    grid: { type: [[Number]], required: true },
    region: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => value.length === 4,
        message: 'region must be [left, top, right, bottom]',
      },
    },
  },
  { _id: false },
);

const diagnosisSchema = new Schema<ScanDiagnosis>(
  {
    classKey: { type: String, required: true },
    isHealthy: { type: Boolean, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    requiredConfidence: { type: Number, required: true, min: 0, max: 1 },
    top: { type: [candidateSchema], default: [] },
    heatmap: { type: heatmapSchema, default: null },
    modelVersion: { type: String, required: true },
    inferenceMs: { type: Number, required: true, min: 0 },
    diagnosedAt: { type: Date, required: true },
  },
  { _id: false },
);

const scanSchema = new Schema<Scan>(
  {
    _id: {
      type: String,
      required: true,
      match: [UUID_V4, 'scan id must be a lower-case UUID v4'],
    },
    userId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    plotId: {
      type: String,
      default: null,
      match: [UUID_V4, 'plotId must be a lower-case UUID v4'],
    },
    crop: { type: String, enum: CROP_CODES, required: false },
    location: { type: pointSchema, required: false },
    capturedAt: { type: Date, required: true },
    photo: { type: photoSchema, required: true },
    status: { type: String, enum: SCAN_STATUSES, required: true, default: 'pending' },
    diagnosis: { type: diagnosisSchema, default: null },
    rejectReason: { type: String, default: null, maxlength: 300 },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, default: null, maxlength: 500 },
    nextAttemptAt: { type: Date, default: null },
    version: { type: Number, default: 1, min: 1 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'scans' },
);

// Every index for this collection, in one place.
//
// The farmer's scan history: owner, live-or-deleted, newest first.
scanSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 }, { name: 'owner_live_recent' });
// The retry sweep: pending scans that are due, soonest first. Partial, so
// the index holds only the small pending set and not every scan ever.
scanSchema.index(
  { status: 1, nextAttemptAt: 1 },
  { name: 'pending_due', partialFilterExpression: { status: 'pending' } },
);
// Week 9 outbreak detection clusters scans by place.
scanSchema.index({ location: '2dsphere' }, { name: 'location_2dsphere' });

export const ScanModel: Model<Scan> = model<Scan>('Scan', scanSchema);
