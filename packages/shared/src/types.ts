import { z } from 'zod';

/**
 * Cross-cutting domain primitives, shared by every module.
 *
 * These shapes appear in `docs/schema.md` as conventions rather than as
 * collections of their own: any user-facing string is a `Locale`, and any
 * coordinate is GeoJSON. Defining them once keeps the Mongoose models, the
 * request validators and the client contract from drifting apart.
 *
 * They live in this package, rather than in the API, because "the client
 * contract" is a real client: both halves of the app now import the same
 * constants instead of each re-declaring them and hoping.
 */

/* -------------------------------------------------------------------------- */
/* Locale                                                                      */
/* -------------------------------------------------------------------------- */

/** Supported UI languages, in the order they are offered to users. */
export const LOCALES = ['ta', 'si', 'en'] as const;

/** A single language tag — Tamil, Sinhala or English. */
export type LocaleCode = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en';

/**
 * A user-facing string in every supported language.
 *
 * Stored embedded rather than in a translations collection: these values are
 * read on nearly every request and are written by administrators, so the join
 * cost would dwarf the storage saved.
 */
export type Locale = Record<LocaleCode, string>;

export const localeCodeSchema = z.enum(LOCALES);

export const localeSchema: z.ZodType<Locale> = z.object({
  ta: z.string().min(1),
  si: z.string().min(1),
  en: z.string().min(1),
});

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* GeoJSON                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A GeoJSON position: **longitude first**, then latitude.
 *
 * The order trips people up constantly, so it is named in the type. Every
 * construction site should still go through {@link point}, which takes the
 * two values by name.
 */
export type GeoPosition = [longitude: number, latitude: number];

/** GeoJSON Point, the shape MongoDB's `2dsphere` index expects. */
export interface GeoPoint {
  type: 'Point';
  coordinates: GeoPosition;
}

/**
 * The two coordinate bounds, on their own.
 *
 * Exported because a form that collects a latitude and a longitude as separate
 * fields -- the manual fallback when GPS is refused -- has to validate them
 * one at a time, and a second copy of `-90..90` written out in the client is
 * exactly the drift this package exists to prevent.
 */
export const longitudeSchema = z.number().min(-180).max(180);
export const latitudeSchema = z.number().min(-90).max(90);

export const geoPositionSchema: z.ZodType<GeoPosition> = z.tuple([longitudeSchema, latitudeSchema]);

export const geoPointSchema: z.ZodType<GeoPoint> = z.object({
  type: z.literal('Point'),
  coordinates: geoPositionSchema,
});

/** Builds a GeoJSON Point from latitude/longitude named arguments. */
export function point(coordinates: { latitude: number; longitude: number }): GeoPoint {
  return { type: 'Point', coordinates: [coordinates.longitude, coordinates.latitude] };
}
