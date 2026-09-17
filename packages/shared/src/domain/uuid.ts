import { z } from 'zod';

/**
 * The identifier every record a farmer authors is addressed by.
 *
 * UUID v4, and only v4. Zod's own `.uuid()` accepts every version, including
 * v1, which encodes the generating machine's MAC address and a timestamp.
 * Those are guessable in bulk, and an id that can be guessed is an id that can
 * be probed for.
 *
 * Normalised to lower case rather than merely accepted in either case. The
 * same UUID typed two ways must resolve to the same row, or the `PUT` upsert
 * that offline sync replays into stops being idempotent the first time a
 * client changes its casing.
 *
 * Lives here, rather than beside the first schema that needed it, because
 * `plots` and `calendarTasks` are now two of them and a second copy of this
 * regex is a second thing to keep right. `docs/architecture.md`, ADR 001, has
 * why the client mints these at all.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidV4Schema = z
  .string()
  .regex(UUID_V4_PATTERN, 'must be a UUID v4')
  .transform((value) => value.toLowerCase());

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}
