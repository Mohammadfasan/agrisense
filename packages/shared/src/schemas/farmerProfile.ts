import { z } from 'zod';

import { cropCodeSchema, CROP_CODES } from '../domain/crops.js';
import { districtSchema } from '../domain/districts.js';
import { geoPointSchema, localeCodeSchema, type LocaleCode } from '../types.js';

/**
 * The farmer profile as a client may send it.
 *
 * Note what is absent: `userId`. The owner of a profile is the authenticated
 * caller and nothing else, so there is no field here for a request to set it
 * with -- an attempt to supply one is dropped by Zod's default stripping
 * rather than rejected, which is the same outcome as sending it to a server
 * that never read it.
 *
 * `fullName`, `district` and `preferredLanguage` overlap `farmers.name`,
 * `.district` and `.language` (`docs/schema.md` §1). The profile is
 * authoritative and the service writes through to the farmer record, because
 * officer district-scoping and `/auth/me` both read the farmer copy: leaving
 * them to diverge would scope a farmer by a district they had already changed.
 */
export const farmerProfileSchema = z.object({
  // Trimmed before the length check, so "  A  " is two characters, not five.
  fullName: z.string().trim().min(2).max(100),
  district: districtSchema,
  /** Grama Niladhari division — one level below `farmers.dsDivision`. */
  gnDivision: z.string().trim().min(1).max(100),
  location: geoPointSchema,
  /**
   * Acres, not the hectares `plots.areaHectares` uses. This is what a farmer
   * knows their own land as; plot areas are computed from a drawn boundary.
   */
  landSizeAcres: z.number().min(0.1).max(1000),
  /**
   * At least one crop: the profile exists to drive advisories and price
   * alerts, and an empty list makes both no-ops. Capped at the whole
   * catalogue, and de-duplicated, so a repeated entry cannot inflate it.
   */
  primaryCrops: z
    .array(cropCodeSchema)
    .min(1)
    .max(CROP_CODES.length)
    .transform((codes) => [...new Set(codes)]),
  /**
   * Optional even in the full schema: the farmer record already holds a
   * language, chosen during sign-in, and the service falls back to it rather
   * than making every client restate it.
   */
  preferredLanguage: localeCodeSchema.optional(),
});

/** A full profile, for `PUT` — every field present, `preferredLanguage` aside. */
export type FarmerProfileInput = z.infer<typeof farmerProfileSchema>;

/**
 * A partial profile, for `PATCH`. An empty object is accepted and changes
 * nothing, which is also what a body containing only unknown keys reduces to.
 */
export const farmerProfileUpdateSchema = farmerProfileSchema.partial();

export type FarmerProfileUpdateInput = z.infer<typeof farmerProfileUpdateSchema>;

/**
 * A saved profile as the API returns it -- the input shape plus the fields the
 * server owns.
 *
 * `_id` and `userId` are strings and the timestamps are ISO strings, because
 * this describes the JSON on the wire rather than the Mongoose document behind
 * it (which types the same fields as `ObjectId` and `Date`). Named `...Record`
 * to keep the two apart where both are in scope.
 *
 * `preferredLanguage` is optional on the way in and always present on the way
 * back: the server resolves it against the farmer record before saving.
 */
export interface FarmerProfileRecord extends Omit<FarmerProfileInput, 'preferredLanguage'> {
  preferredLanguage: LocaleCode;
  _id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}
