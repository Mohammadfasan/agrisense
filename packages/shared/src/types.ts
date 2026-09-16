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

/**
 * A closed linear ring: the boundary of one polygon face.
 *
 * GeoJSON requires four positions minimum and the last to repeat the first, so
 * the smallest legal ring is a triangle written with four points. Both rules
 * are enforced here rather than left to MongoDB, which rejects an unclosed ring
 * at insert time with a driver error -- a 500 for what is a malformed request.
 */
export type GeoLinearRing = GeoPosition[];

/**
 * GeoJSON Polygon. The first ring is the outer boundary; any further rings are
 * holes, which the plot editor does not draw today but the format allows and
 * this validator therefore accepts.
 */
export interface GeoPolygon {
  type: 'Polygon';
  coordinates: GeoLinearRing[];
}

export const geoLinearRingSchema: z.ZodType<GeoLinearRing> = z
  .array(geoPositionSchema)
  .min(4, 'a linear ring needs at least 4 positions')
  .superRefine((ring, ctx) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    // `min(4)` above guarantees both, but `noUncheckedIndexedAccess` does not
    // know that and a `!` here would be the one place this file lies.
    if (!first || !last) {
      return;
    }
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a linear ring must be closed — the last position must repeat the first',
      });
    }
  });

export const geoPolygonSchema: z.ZodType<GeoPolygon> = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(geoLinearRingSchema).min(1, 'a polygon needs at least an outer ring'),
});

/**
 * The area-weighted centroid of a polygon's outer ring.
 *
 * Longitude and latitude are treated as plane coordinates. Over a field of a
 * few hectares the error from ignoring the earth's curvature is centimetres,
 * and the centroid only ever feeds proximity queries and outbreak clustering,
 * neither of which can tell. Doing it properly would mean projecting to a
 * local UTM zone for no reachable difference in the answer.
 *
 * A ring enclosing no area -- every point identical, or all of them collinear
 * -- makes the shoelace formula divide by zero, so that case falls back to the
 * mean of the vertices.
 */
export function polygonCentroid(polygon: GeoPolygon): GeoPoint {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) {
    throw new Error('polygon has no outer ring');
  }

  // The closing position repeats the first and must not be counted twice.
  const vertices = ring.slice(0, -1);
  if (vertices.length === 0) {
    throw new Error('polygon outer ring has no distinct positions');
  }

  // The shoelace sum runs on coordinates measured from the first vertex, not
  // from (0, 0). A plot is a few hundred metres across at 80°E, so the cross
  // products of absolute coordinates are ~10^3 while the area they encode is
  // ~10^-6: the terms very nearly cancel, and the doubles lose most of their
  // significant digits doing it. Measured from a local origin the magnitudes
  // match and the cancellation goes away. Translating is free -- a centroid
  // moves exactly as its polygon does -- so the origin is added back at the
  // end. Without this the answer drifts by roughly 10 cm.
  const origin = vertices[0];
  if (!origin) {
    throw new Error('polygon outer ring has no distinct positions');
  }

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) {
      continue;
    }
    const cx = current[0] - origin[0];
    const cy = current[1] - origin[1];
    const nx = next[0] - origin[0];
    const ny = next[1] - origin[1];

    const cross = cx * ny - nx * cy;
    twiceArea += cross;
    x += (cx + nx) * cross;
    y += (cy + ny) * cross;
  }

  if (twiceArea === 0) {
    const sum = vertices.reduce<[number, number]>(
      (acc, position) => [acc[0] + position[0], acc[1] + position[1]],
      [0, 0],
    );
    return { type: 'Point', coordinates: [sum[0] / vertices.length, sum[1] / vertices.length] };
  }

  const scale = 3 * twiceArea;
  return { type: 'Point', coordinates: [x / scale + origin[0], y / scale + origin[1]] };
}
