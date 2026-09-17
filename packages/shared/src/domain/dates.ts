import { z } from 'zod';

/**
 * Calendar days, as days rather than as instants.
 *
 * A farming task happens on a *day*. "Top-dress the paddy on 12 June" is not
 * an event at a time; there is no hour attached to it and there never will be.
 * Storing that as a `Date` is the bug this module exists to prevent:
 *
 * - Sri Lanka is UTC+05:30. `new Date('2026-06-12')` in a browser at local
 *   midnight is `2026-06-11T18:30:00Z`, and the moment it round-trips through
 *   an ISO string every task in the app moves back a day.
 * - The half-hour offset means the usual escape hatches do not work either.
 *   Truncating to midnight in the server's own zone, or rendering with
 *   `toLocaleDateString` on a device set to anything but Colombo, shifts the
 *   day for some values and not others — which is worse than shifting all of
 *   them, because it looks correct in testing.
 *
 * So a day is the string `YYYY-MM-DD`, stored as that string, compared as that
 * string, and never converted to a `Date` on the way in or out. Lexical order
 * on this format is chronological order, which is what lets MongoDB range
 * queries and index sorts work on it unchanged.
 *
 * No date library, by instruction and because none is warranted: the two
 * operations needed here are "add N days" and "what is today in Colombo", and
 * both are a few lines of UTC arithmetic.
 */

/**
 * A calendar day as `YYYY-MM-DD`.
 *
 * An alias rather than a branded type: it travels through JSON, Mongoose and
 * Zod, and a brand would be cast away at every one of those boundaries without
 * buying a check that {@link isoDateSchema} does not already make.
 */
export type IsoDate = string;

/** Shape only. A shape that passes here can still be 2026-02-30. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sri Lanka Standard Time, in minutes ahead of UTC.
 *
 * Fixed: the country has observed +05:30 with no daylight saving since 2006,
 * so this is a constant rather than something to look up per date.
 */
export const SRI_LANKA_UTC_OFFSET_MINUTES = 330;

const MS_PER_DAY = 86_400_000;

/**
 * Whether a `YYYY-MM-DD` string names a day that exists.
 *
 * The regex cannot do this. `2026-02-30`, `2026-13-01` and `2025-02-29` all
 * match it, and `new Date('2026-02-30')` does not throw — it rolls forward to
 * 2 March, silently. So the parts are read back out of the constructed date
 * and compared with what went in; a date that rolled over disagrees.
 */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * A calendar day: `YYYY-MM-DD`, and a day that exists.
 *
 * Deliberately not `z.coerce.date()` or `z.string().datetime()`. Both would
 * accept a timestamp and hand back something with an hour on it, and the hour
 * is what moves a task across midnight.
 */
export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, 'must be a date as YYYY-MM-DD')
  .refine(isIsoDate, 'must be a real calendar date');

/**
 * The UTC day an instant falls on, as `YYYY-MM-DD`.
 *
 * UTC and not local time, because the instants this reads — `plots.plantedAt`,
 * for one — are written as UTC midnight of the day they mean. Reading them in
 * any other zone is what puts them on the day before.
 */
export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/**
 * The day `days` after (or, negative, before) the given one.
 *
 * Both ends are UTC midnights, so nothing here can land on a boundary: there
 * is no DST in UTC, and the arithmetic is exact in milliseconds well past any
 * date this app will see.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const start = new Date(`${date}T00:00:00.000Z`).getTime();

  if (Number.isNaN(start) || !Number.isInteger(days)) {
    throw new RangeError(`Cannot add ${String(days)} days to ${date}`);
  }
  return toIsoDate(new Date(start + days * MS_PER_DAY));
}

/**
 * Today, where the farmer is.
 *
 * The server may be in any zone — UTC in production, whatever a developer's
 * laptop is set to otherwise — and "today" has to mean the day it is in the
 * field. Between 18:30 and 24:00 UTC it is already tomorrow in Colombo, and a
 * task completed at 7am local on the 5th must not be recorded on the 4th.
 */
export function todayInSriLanka(now: Date = new Date()): IsoDate {
  return toIsoDate(new Date(now.getTime() + SRI_LANKA_UTC_OFFSET_MINUTES * 60_000));
}
