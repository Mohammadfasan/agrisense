import { z } from 'zod';

/**
 * The districts the platform operates in.
 *
 * An enum rather than free text, because district is the scoping key for every
 * officer query and the grouping key for outbreak clustering: a profile saved
 * as "Anuradapura" would silently drop out of both. `farmers.district` and
 * `plots.district` are still typed as plain strings in `docs/schema.md` §1 and
 * §4 -- they predate this list, and widening them to it is a migration, not a
 * schema change.
 *
 * Stored in the canonical English spelling. These are administrative
 * identifiers, so they are not translated; the UI looks up a display name.
 */
export const DISTRICTS = ['Anuradhapura', 'Polonnaruwa', 'Kurunegala'] as const;

export type District = (typeof DISTRICTS)[number];

export const districtSchema = z.enum(DISTRICTS);

export function isDistrict(value: unknown): value is District {
  return typeof value === 'string' && (DISTRICTS as readonly string[]).includes(value);
}
