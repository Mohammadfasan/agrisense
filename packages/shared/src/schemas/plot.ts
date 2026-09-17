import { z } from 'zod';

import { cropCodeSchema } from '../domain/crops.js';
import { uuidV4Schema } from '../domain/uuid.js';
import { geoPointSchema, geoPolygonSchema } from '../types.js';

/**
 * A plot — one worked parcel of land, owned by one farmer.
 *
 * The identifier is the first thing to notice: a plot's `_id` is a UUID v4 the
 * *client* generates, not an ObjectId the server hands back. See
 * `docs/architecture.md` — "Client-generated identifiers" — for why. The
 * consequence here is that `_id` is part of the request contract and therefore
 * has to be validated like any other untrusted input.
 *
 * As with `farmerProfileSchema`, `userId` is absent from every input schema:
 * the owner is the authenticated caller and there is no field for a request to
 * claim otherwise with.
 */

/**
 * A plot id: a lower-cased UUID v4. See `domain/uuid.ts` for why only v4 and
 * why the case is normalised.
 */
export const plotIdSchema = uuidV4Schema;

export type PlotId = z.infer<typeof plotIdSchema>;

/**
 * The fields a client may write.
 *
 * Kept as a plain object schema with no refinements so `.partial()` below can
 * still reach it — Zod's `.partial()` is defined on `ZodObject`, and a
 * `.superRefine()` returns a `ZodEffects` that has no such method.
 */
const plotWritableSchema = z.object({
  name: z.string().trim().min(1).max(60),
  crop: cropCodeSchema,
  /**
   * Acres, matching `farmerProfiles.landSizeAcres` and what a farmer here
   * actually knows their land as. The floor is a fortieth of an acre — about
   * 100 m², smaller than any real plot but large enough to catch a zero or a
   * stray minus sign.
   */
  areaAcres: z.number().min(0.01).max(1000),
  /** Drawn on the map. Optional: a farmer may drop a pin and type an area. */
  boundary: geoPolygonSchema.optional(),
  /**
   * Optional on the way in and required on the way out: when a boundary is
   * supplied and this is not, the server derives it. See `plot.service`.
   */
  centroid: geoPointSchema.optional(),
  plantedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * A plot as a client creates or replaces it, for `PUT`.
 *
 * The one cross-field rule: a plot has to be locatable. Either the client
 * drew a boundary, from which a centroid can be derived, or it gave the point
 * directly. Neither leaves the plot unplaceable on the outbreak map, which is
 * the one thing every plot is for.
 */
export const plotCreateSchema = plotWritableSchema.superRefine((plot, ctx) => {
  if (!plot.boundary && !plot.centroid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['centroid'],
      message: 'a plot needs either a boundary or a centroid',
    });
  }
});

export type PlotInput = z.infer<typeof plotCreateSchema>;

/**
 * A partial plot, for `PATCH`. No cross-field rule: a plot that already exists
 * is already locatable, and a patch that touches neither field cannot change
 * that. An empty object is accepted and changes nothing.
 */
export const plotUpdateSchema = plotWritableSchema.partial();

export type PlotUpdateInput = z.infer<typeof plotUpdateSchema>;

/**
 * A saved plot, as the API returns it — the writable fields plus the ones the
 * server owns.
 *
 * Dates are coerced rather than required to be `Date` instances, so the same
 * schema parses a response body off the wire on the client and a lean document
 * on the server.
 */
export const plotSchema = plotWritableSchema.extend({
  _id: plotIdSchema,
  /** The owning farmer's ObjectId, rendered as a hex string in JSON. */
  userId: z.string(),
  /** Always present on a saved plot, whatever the client sent. */
  centroid: geoPointSchema,
  /**
   * Bumped on every write, including the soft delete. The client compares it
   * to the version it last saw to decide whether its offline copy is stale.
   */
  version: z.number().int().min(1),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type PlotRecord = z.infer<typeof plotSchema>;

/** Page size bounds for `GET /plots`, shared so the client cannot ask for more. */
export const PLOT_PAGE_SIZE_DEFAULT = 20;
export const PLOT_PAGE_SIZE_MAX = 100;

/**
 * Query string for `GET /plots`.
 *
 * Cursor pagination rather than `skip`/`limit`: plots are ordered by
 * `updatedAt` descending, and an edit made between two `skip` pages reorders
 * the list under the reader, so a row shifts across the page boundary and is
 * either served twice or missed entirely. A cursor names a position in the
 * ordering instead of counting from the start, so neither happens.
 *
 * The cursor is opaque to the client — a base64url pair of `updatedAt` and
 * `_id`, built by `plot.service`. Its contents are the server's business and
 * its format may change; clients echo back what they were given.
 */
export const plotListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PLOT_PAGE_SIZE_MAX).default(PLOT_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).optional(),
});

export type PlotListQuery = z.infer<typeof plotListQuerySchema>;
