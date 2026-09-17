import {
  latitudeSchema,
  longitudeSchema,
  plotCreateSchema,
  point,
  type GeoPolygon,
  type PlotInput,
  type PlotRecord,
} from '@agrisense/shared';
import { z } from 'zod';

/**
 * The plot form's contract.
 *
 * Derived from the shared `plotCreateSchema` rather than written out again, so
 * the name length, the crop list and the area bounds are the rules the API
 * enforces and there is no second copy to drift — the same reasoning as
 * `onboarding.ts`.
 *
 * `plotCreateSchema` carries a `.superRefine`, which makes it a `ZodEffects`
 * with no `.omit()` on it. `.innerType()` reaches the object underneath. The
 * refinement it drops is the "a plot needs either a boundary or a centroid"
 * rule, which this form satisfies structurally: it always collects a centroid.
 *
 * Three reshapings, for the same reason in each case — the stored shape is not
 * the shape a farmer can type:
 *
 * - `centroid` becomes `latitude` and `longitude`. Two number fields, in the
 *   order they are spoken, instead of a GeoJSON pair whose convention is
 *   longitude-first and whose swap nobody would spot in the markup.
 * - `plantedAt` becomes the `yyyy-mm-dd` string an `<input type="date">`
 *   holds, and an empty one means "not planted yet" rather than an error.
 * - `boundary` is dropped. Drawing one is out of scope for these screens; a
 *   plot that already has one keeps it through {@link toPlotInput}.
 */
const plotWritableSchema = plotCreateSchema.innerType();

/**
 * `<input type="date">` gives `yyyy-mm-dd`, or `''` once it is cleared.
 * Parsed as UTC midnight, which is both what `new Date('2026-05-01')` does and
 * how the API renders the field back.
 */
const plantedAtSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), 'must be a date')
  .transform((value) => (value === '' ? undefined : new Date(value)));

export const plotFormSchema = plotWritableSchema
  .omit({ boundary: true, centroid: true, plantedAt: true, notes: true })
  .extend({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    plantedAt: plantedAtSchema,
    // A textarea holds `''` when empty, not `undefined`. Emptied notes should
    // clear the field rather than save a blank string over it.
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value === '' ? undefined : value)),
  });

/** What the fields hold. */
export type PlotFormValues = z.input<typeof plotFormSchema>;
/** What they mean, once parsed. */
export type PlotFormOutput = z.output<typeof plotFormSchema>;

/**
 * Turns the flat form values into the body `PUT /plots/:id` takes.
 *
 * `boundary` is passed back in rather than left out, and that is not a detail:
 * `PUT` replaces the whole resource, so an omitted optional field is cleared.
 * These screens cannot draw a boundary, so a plot that arrived with one would
 * silently lose it the first time its name was corrected. Handing the existing
 * outline back is what keeps this form's ignorance of polygons from being
 * destructive.
 */
export function toPlotInput(values: PlotFormOutput, boundary?: GeoPolygon): PlotInput {
  const { latitude, longitude, plantedAt, notes, ...rest } = values;

  return {
    ...rest,
    // Named arguments, so longitude-first ordering is the helper's problem
    // rather than this call site's.
    centroid: point({ latitude, longitude }),
    // Spread rather than assigned: under `exactOptionalPropertyTypes` a key
    // that is present and `undefined` is not the same as an absent one, and
    // only the absent one means "no value" to the API.
    ...(boundary === undefined ? {} : { boundary }),
    ...(plantedAt === undefined ? {} : { plantedAt }),
    ...(notes === undefined ? {} : { notes }),
  };
}

/** Seeds the form from a saved plot, for the edit screen. */
export function toFormValues(plot: PlotRecord): PlotFormValues {
  const [longitude, latitude] = plot.centroid.coordinates;

  return {
    name: plot.name,
    crop: plot.crop,
    areaAcres: plot.areaAcres,
    latitude,
    longitude,
    // `== null`: the API sends `null` for an unplanted plot, and an older
    // document may have no key at all.
    plantedAt: plot.plantedAt == null ? '' : toDateInput(plot.plantedAt),
    notes: plot.notes ?? '',
  };
}

/**
 * A `Date` as the `yyyy-mm-dd` a date input wants, read in UTC.
 *
 * UTC and not local time, to match how {@link plantedAtSchema} writes it. A
 * local reading would move the date by a day for any farmer west of Greenwich
 * — not this audience, but the asymmetry is the kind that survives a move.
 */
function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}
