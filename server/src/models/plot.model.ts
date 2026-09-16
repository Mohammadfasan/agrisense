import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { CROP_CODES, type CropCode, type GeoPoint, type GeoPolygon } from '@shared/types';

/**
 * `plots` — one worked parcel of land, owned by one farmer.
 *
 * **The `_id` is a UUID v4 the client generated**, not an ObjectId this server
 * minted. That is the whole point: a farmer standing in a field with no signal
 * creates the plot locally, and when the phone reconnects the sync writes it
 * under the id it already has. A retried or duplicated sync therefore lands on
 * the same row instead of creating a second one. `docs/architecture.md`,
 * "Client-generated identifiers", has the reasoning and what it costs.
 *
 * Because the id arrives from outside, it is validated like any other
 * untrusted input -- here as a last line of defence, and in
 * `plotIdSchema` (`@agrisense/shared`) as the one that produces a 422.
 *
 * `version` and `deletedAt` exist for the same sync: a client compares
 * `version` against the copy it holds to detect a stale write, and a hard
 * delete would be invisible to a device that never saw it, so deletes are
 * tombstones that sync like any other change.
 */

/** Mirrors `plotIdSchema`. Kept in sync by `plot.model.test`-adjacent tests. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Plot {
  /** Client-generated UUID v4, lower case. */
  _id: string;
  /** ref `farmers`. Never read from a request body -- see `plot.service`. */
  userId: Types.ObjectId;
  name: string;
  crop: CropCode;
  areaAcres: number;
  /** Drawn on the map. Absent when the farmer only dropped a pin. */
  boundary?: GeoPolygon;
  /** Derived from `boundary` when the client does not send one. */
  centroid: GeoPoint;
  plantedAt?: Date | null;
  notes?: string | null;
  /** Incremented on every write, including the soft delete. */
  version: number;
  /** Soft delete. A tombstone keeps the UUID reserved against re-creation. */
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PlotDocument = HydratedDocument<Plot>;

const centroidSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    // Longitude first. Bounds live in `geoPositionSchema`, on the request
    // path, for the same reason as `farmerProfiles.location`: a Mongoose
    // validation failure is a 500, and a bad coordinate has earned a 422.
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

const boundarySchema = new Schema<GeoPolygon>(
  {
    type: { type: String, enum: ['Polygon'], required: true, default: 'Polygon' },
    // An array of linear rings, each an array of [lng, lat] positions.
    coordinates: {
      type: [[[Number]]],
      required: true,
      validate: {
        // Ring closure is checked properly by `geoLinearRingSchema`. This
        // catches only the shape MongoDB itself would reject at insert time
        // with a driver error rather than a validation one.
        validator: (rings: number[][][]) =>
          rings.length > 0 && rings.every((ring) => ring.length >= 4),
        message: 'each linear ring needs at least 4 positions',
      },
    },
  },
  { _id: false },
);

const plotSchema = new Schema<Plot>(
  {
    _id: {
      type: String,
      required: true,
      match: [UUID_V4, 'plot id must be a lower-case UUID v4'],
    },
    userId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    crop: { type: String, enum: CROP_CODES, required: true },
    areaAcres: { type: Number, required: true, min: 0.01, max: 1000 },
    boundary: { type: boundarySchema, required: false },
    // Required even though the client may omit it: `plot.service` derives it
    // from the boundary before anything reaches here, so a document without
    // one is a defect rather than a bad request.
    centroid: { type: centroidSchema, required: true },
    plantedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    version: { type: Number, default: 1, min: 1 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'plots' },
);

// Declared here rather than on the paths, so every index for this collection
// is visible in one place.
//
// Week 9 clusters scans and plots by proximity (DBSCAN) to find outbreaks;
// `$near` and `$geoWithin` both need this and neither can use a plain index.
plotSchema.index({ centroid: '2dsphere' }, { name: 'centroid_2dsphere' });
// The list endpoint's exact shape: owner, then live-or-deleted, then the sort
// key. With `updatedAt` descending in the index, the paged query walks it in
// order and never sorts in memory.
plotSchema.index({ userId: 1, deletedAt: 1, updatedAt: -1 }, { name: 'owner_live_recent' });

export const PlotModel: Model<Plot> = model<Plot>('Plot', plotSchema);
