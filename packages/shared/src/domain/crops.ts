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

/**
 * Planting to final harvest, in days, per crop.
 *
 * Here rather than only on the server because the client draws a crop-stage
 * bar from it — how far through the season a plot is — and that has to be
 * computed at render time from `plantedAt` and today. A stored progress value
 * would be wrong by morning.
 *
 * These mirror `totalDays` in `server/src/data/crop-calendar-templates.json`,
 * which is the file an agronomist reviews. The server asserts the two agree at
 * boot (`cropCalendar.templates.ts`), so a corrected season length cannot land
 * in one and not the other.
 */
export const CROP_GROWING_DAYS: Readonly<Record<CropCode, number>> = {
  PADDY: 120,
  TOMATO: 100,
  CHILLI: 130,
  ONION: 95,
  BRINJAL: 130,
};
