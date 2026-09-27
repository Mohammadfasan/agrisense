import { z } from 'zod';

/** Mirrors `plotIdSchema` and the Scan model's own check. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid = z.string().regex(UUID_V4, 'must be a lower-case UUID v4');

export const scanIdSchema = uuid;

/** A phone's clock can be a little ahead of the server's. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** An offline scan can wait a long time to upload, but not forever. */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Multipart fields always arrive as strings; an empty one means "not sent". */
const blankToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * The text fields sent alongside the photo.
 *
 * `capturedAt` must carry a time zone (`...Z` or `+05:30`): a bare local time
 * would be read differently by the server and the phone.
 */
export const scanFieldsSchema = z
  .object({
    plotId: z.preprocess(blankToUndefined, uuid.optional()).transform((value) => value ?? null),
    capturedAt: z
      .string()
      .datetime({ offset: true, message: 'must be an ISO timestamp with a time zone' })
      .transform((value) => new Date(value))
      .refine((date) => date.getTime() <= Date.now() + CLOCK_SKEW_MS, 'cannot be in the future')
      .refine((date) => date.getTime() >= Date.now() - MAX_AGE_MS, 'is more than a year old'),
    longitude: z.preprocess(blankToUndefined, z.coerce.number().min(-180).max(180).optional()),
    latitude: z.preprocess(blankToUndefined, z.coerce.number().min(-90).max(90).optional()),
  })
  .refine((value) => (value.longitude === undefined) === (value.latitude === undefined), {
    message: 'longitude and latitude must be sent together',
    path: ['latitude'],
  });

export type ScanFields = z.infer<typeof scanFieldsSchema>;
