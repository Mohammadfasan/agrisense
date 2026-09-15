import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  CROP_CODES,
  DISTRICTS,
  LOCALES,
  type CropCode,
  type District,
  type GeoPoint,
  type LocaleCode,
} from '@shared/types';

/**
 * `farmerProfiles` — the agronomic detail behind a farmer's identity.
 *
 * Separate from `farmers` (`docs/schema.md` §1) because the two are written on
 * different occasions and read on different paths: `farmers` is touched by
 * every authenticated request through `authenticate`, while this is filled in
 * once after sign-up and edited rarely. Keeping the land, location and crop
 * fields out of the hot document keeps that per-request read small.
 *
 * `fullName`, `district` and `preferredLanguage` deliberately mirror
 * `farmers.name`, `.district` and `.language`. This collection is
 * authoritative and `farmerProfile.service` writes through to the farmer
 * record on every save -- officer district-scoping and `/auth/me` read the
 * farmer copy, so the two must not be allowed to disagree.
 */

export interface FarmerProfile {
  _id: Types.ObjectId;
  /** ref `farmers`. One profile per farmer, enforced by a unique index. */
  userId: Types.ObjectId;
  fullName: string;
  district: District;
  /** Grama Niladhari division — one level below `farmers.dsDivision`. */
  gnDivision: string;
  /** Homestead or main holding. The clustering input for Week 9 outbreaks. */
  location: GeoPoint;
  landSizeAcres: number;
  primaryCrops: CropCode[];
  preferredLanguage: LocaleCode;
  createdAt: Date;
  updatedAt: Date;
}

export type FarmerProfileDocument = HydratedDocument<FarmerProfile>;

const locationSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    // Longitude first. Bounds are enforced by `geoPositionSchema` on the way
    // in; repeating them here would put the error in the wrong layer -- a
    // Mongoose validation failure is a 500, not the 422 a bad request earns.
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

const farmerProfileSchema = new Schema<FarmerProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    district: { type: String, enum: DISTRICTS, required: true },
    gnDivision: { type: String, required: true, trim: true, maxlength: 100 },
    location: { type: locationSchema, required: true },
    landSizeAcres: { type: Number, required: true, min: 0.1, max: 1000 },
    primaryCrops: {
      type: [{ type: String, enum: CROP_CODES }],
      required: true,
      validate: {
        validator: (value: string[]) => value.length > 0,
        message: 'at least one crop is required',
      },
    },
    // No `default`: the correct fallback is the farmer's own language, which a
    // schema default cannot reach. The service supplies it.
    preferredLanguage: { type: String, enum: LOCALES, required: true },
  },
  { timestamps: true, collection: 'farmerProfiles' },
);

// Declared here rather than as `unique: true`/`index: true` on the paths, so
// every index for this collection is visible in one place.
farmerProfileSchema.index({ userId: 1 }, { unique: true, name: 'userId_unique' });
// Week 9 outbreak clustering (DBSCAN) scans profiles by proximity; district is
// the pre-filter the officer dashboard applies before it does.
farmerProfileSchema.index({ location: '2dsphere' }, { name: 'location_2dsphere' });
farmerProfileSchema.index({ district: 1 }, { name: 'district' });

export const FarmerProfileModel: Model<FarmerProfile> = model<FarmerProfile>(
  'FarmerProfile',
  farmerProfileSchema,
);
