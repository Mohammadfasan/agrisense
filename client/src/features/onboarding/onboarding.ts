import {
  CROP_CODES,
  cropCodeSchema,
  districtSchema,
  farmerProfileSchema,
  latitudeSchema,
  longitudeSchema,
  point,
  type FarmerProfileInput,
} from '@agrisense/shared';
import { z } from 'zod';

/**
 * The wizard's form contract.
 *
 * Derived from the shared `farmerProfileSchema` rather than written out again,
 * so the name length, the district list, the crop list and the land bounds are
 * the same rules the API enforces -- there is no second copy to drift.
 *
 * Two deliberate reshapings:
 *
 * - `location` becomes `latitude` and `longitude`. A GeoJSON Point is the
 *   right shape to store and the wrong shape to collect: step 3 has two number
 *   fields, and registering `location.coordinates.0` would put longitude-first
 *   ordering into the markup where a reader would have to know the convention
 *   to spot a swap. The bounds still come from the shared package.
 * - `preferredLanguage` is dropped. The wizard never asks -- the farmer chose
 *   a language on S-01, before any of this -- and the API defaults the field
 *   from the farmer record when it is absent.
 */
export const onboardingSchema = farmerProfileSchema
  .omit({ location: true, preferredLanguage: true })
  .extend({ latitude: latitudeSchema, longitude: longitudeSchema });

/** What the fields hold. `primaryCrops` is de-duplicated on the way out. */
export type OnboardingValues = z.input<typeof onboardingSchema>;
export type OnboardingOutput = z.output<typeof onboardingSchema>;

/** Field names, grouped one step per entry. */
export const STEP_FIELDS = [
  ['fullName', 'district', 'gnDivision'],
  ['landSizeAcres', 'primaryCrops'],
  ['latitude', 'longitude'],
] as const satisfies readonly (readonly (keyof OnboardingValues)[])[];

export const STEP_COUNT = STEP_FIELDS.length;

/** Turns the flat form values into the body the API takes. */
export function toProfileInput(values: OnboardingOutput): FarmerProfileInput {
  const { latitude, longitude, ...rest } = values;
  // Named arguments, so the longitude-first ordering is the helper's problem
  // rather than this call site's.
  return { ...rest, location: point({ latitude, longitude }) };
}

/* -------------------------------------------------------------------------- */
/* Draft persistence                                                          */
/* -------------------------------------------------------------------------- */

const DRAFT_KEY = 'agrisense.onboarding';

/**
 * What a saved draft may contain.
 *
 * Every field optional and only loosely checked, which is the point: a draft
 * is work in progress, and it has to be able to hold a half-typed name or an
 * empty crop list without the whole thing being thrown away on restore. The
 * real rules are `onboardingSchema`, applied on submit. This exists to keep
 * junk out of the form -- sessionStorage is editable by anyone at the console
 * -- not to decide what is valid.
 */
const draftSchema = z.object({
  step: z
    .number()
    .int()
    .min(0)
    .max(STEP_COUNT - 1)
    .optional(),
  values: z
    .object({
      fullName: z.string().max(100),
      district: districtSchema,
      gnDivision: z.string().max(100),
      landSizeAcres: z.number().finite(),
      primaryCrops: z.array(cropCodeSchema).max(CROP_CODES.length),
      latitude: z.number().finite(),
      longitude: z.number().finite(),
    })
    .partial()
    .optional(),
});

/**
 * A restored draft. Writing takes `unknown` values and reading returns these:
 * the form hands over a deep-partial of itself, and validating on the way back
 * in is both simpler to type and the safer direction to check.
 */
export interface OnboardingDraft {
  step: number;
  /**
   * Only the fields the draft actually had. A key is absent rather than
   * present-and-undefined, which is what lets these go straight into
   * react-hook-form's `defaultValues` under `exactOptionalPropertyTypes`.
   */
  values: Partial<OnboardingValues>;
}

/**
 * Reads the saved draft. Returns an empty one when there is nothing stored,
 * when it cannot be parsed, or when storage is unavailable -- a farmer in a
 * private window still gets a working wizard, just without the safety net.
 */
export function readDraft(): OnboardingDraft {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return EMPTY_DRAFT;
  }
  if (raw === null) {
    return EMPTY_DRAFT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }

  const result = draftSchema.safeParse(parsed);
  if (!result.success) {
    return EMPTY_DRAFT;
  }

  // Copied key by key rather than spread. Zod types every optional field as
  // `T | undefined`, and under `exactOptionalPropertyTypes` a property that is
  // present and undefined is not the same as one that is absent -- the form
  // rejects the former. `keep` drops them, and does it without a cast.
  const stored = result.data.values ?? {};
  const values: Partial<OnboardingValues> = {};
  keep(values, 'fullName', stored.fullName);
  keep(values, 'district', stored.district);
  keep(values, 'gnDivision', stored.gnDivision);
  keep(values, 'landSizeAcres', stored.landSizeAcres);
  keep(values, 'primaryCrops', stored.primaryCrops);
  keep(values, 'latitude', stored.latitude);
  keep(values, 'longitude', stored.longitude);

  return { step: result.data.step ?? 0, values };
}

function keep<K extends keyof OnboardingValues>(
  target: Partial<OnboardingValues>,
  key: K,
  value: OnboardingValues[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export function writeDraft(draft: { step: number; values: unknown }): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Out of quota, or storage blocked. The wizard still works; a refresh
    // just starts it over, which is the behaviour without this feature at all.
  }
}

/** Called once the profile is saved, so a later visit starts clean. */
export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was stored in the first place.
  }
}

const EMPTY_DRAFT: OnboardingDraft = { step: 0, values: {} };
