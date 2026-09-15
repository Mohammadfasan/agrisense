import { z } from 'zod';

/**
 * The crops the platform supports, as the stable codes `crops.code` holds
 * (`docs/schema.md` §5).
 *
 * Codes rather than the `crops` ObjectIds the rest of the schema references,
 * because this list is a farmer's declaration of what they grow, not a
 * reference to a master-data row: validating it must not require a round trip,
 * and it has to be checkable on the client, offline, where no ObjectId means
 * anything. A planting still points at a `crops` document by id.
 */
export const CROP_CODES = ['PADDY', 'TOMATO', 'CHILLI', 'ONION', 'BRINJAL'] as const;

export type CropCode = (typeof CROP_CODES)[number];

export const cropCodeSchema = z.enum(CROP_CODES);

export function isCropCode(value: unknown): value is CropCode {
  return typeof value === 'string' && (CROP_CODES as readonly string[]).includes(value);
}
