import { addDays as addDaysUnchecked, isIsoDate, todayInSriLanka, type IsoDate } from '@shared';

/**
 * Day arithmetic on `YYYY-MM-DD` strings.
 *
 * **Nothing here constructs a local-midnight `Date`, and that is the whole
 * point of the module.** Sri Lanka is UTC+05:30, so `new Date('2026-06-12')`
 * on a machine in Colombo is `2026-06-11T18:30:00Z`; the moment that value
 * round-trips through an ISO string, every task in the app moves back a day.
 * The half-hour offset rules out the usual escapes too — truncating to
 * midnight in the server's own zone shifts some values and not others, which
 * is worse than shifting all of them because it looks correct in testing.
 *
 * So every function below either compares the strings directly, which is exact
 * because `YYYY-MM-DD` sorts lexically in the order it sorts chronologically,
 * or parses to a **UTC** midnight and does integer millisecond arithmetic.
 * There is no daylight saving in UTC and no offset to apply, so a day is
 * exactly 86,400,000 ms and the arithmetic is exact well past any date this
 * app will see.
 *
 * **{@link addDays} and {@link todayInColombo} delegate to
 * `@agrisense/shared`'s `domain/dates.ts` rather than reimplementing it.** The
 * package already has both, written to the same rule, and the client imports
 * them from there. A second copy of the same UTC arithmetic living on the
 * server is exactly the drift the shared package exists to prevent — it would
 * be correct on the day it was written, and then only one of the two would get
 * fixed. What this module adds is the pair the generator and the
 * `/calendar/today` buckets need and the package does not have:
 * {@link diffDays} and {@link isBefore}.
 */

const MS_PER_DAY = 86_400_000;

export type { IsoDate };

/**
 * The day `days` after (or, negative, before) the given one.
 *
 * The arithmetic is `@agrisense/shared`'s; what this wrapper adds is the
 * validation of the input day, which the shared function does not do. Its
 * guard only catches a string `Date` cannot parse at all, and `2026-02-30` is
 * not one of those: `new Date('2026-02-30T00:00:00.000Z')` rolls silently
 * forward to 2 March, so `addDays('2026-02-30', 1)` there answers
 * `'2026-03-03'` — a confident, wrong day rather than an error.
 *
 * That trap is the one `isIsoDate` exists to close, and it is closed here
 * rather than in the package because the package is also the client's and
 * changing it is a wider change than this one is. Worth raising separately:
 * every other caller of the shared `addDays` still has the hole.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  assertIsoDate(date);
  return addDaysUnchecked(date, days);
}

/**
 * Today, where the farmer is.
 *
 * The server may be in any zone — UTC in production, whatever a developer's
 * laptop is set to otherwise — and "today" has to mean the day it is in the
 * field. Between 18:30 and 24:00 UTC it is already tomorrow in Colombo, so a
 * task ticked off at 7am local on the 5th must not be recorded on the 4th.
 *
 * Named for Colombo rather than for the country, matching how the rest of this
 * module and `docs/schema.md` §19 talk about it; the shared implementation it
 * delegates to is `todayInSriLanka`, and the two are the same function.
 */
export function todayInColombo(now: Date = new Date()): IsoDate {
  return todayInSriLanka(now);
}

/**
 * Whole days from `from` to `to`.
 *
 * Signed, and in that direction: `diffDays('2026-06-10', '2026-06-12')` is
 * `2`, and swapping the arguments gives `-2`. The parameters are named rather
 * than positional-by-convention because the opposite sign is just as
 * defensible a choice and a caller should not have to guess which one this is.
 *
 * Exact for every pair of real dates. Both ends are UTC midnights, so the
 * difference is always a whole number of days with no remainder to round —
 * which is not true of any implementation that goes through local time.
 */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return (utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY;
}

/**
 * Whether `a` falls strictly before `b`. Equal days are `false`.
 *
 * A plain string comparison, which is not a shortcut but the exact answer:
 * `YYYY-MM-DD` is fixed-width and most-significant-first, so lexical order on
 * it *is* chronological order. This is the same property the MongoDB range
 * queries in `calendarTask.service` rely on, and using anything else here
 * would let the two disagree at a boundary.
 *
 * Both arguments are still validated. A caller that passes `'not-a-day'` has a
 * defect, and returning a confident `false` would hide it.
 */
export function isBefore(a: IsoDate, b: IsoDate): boolean {
  assertIsoDate(a);
  assertIsoDate(b);
  return a < b;
}

/**
 * The UTC midnight of a day, in milliseconds.
 *
 * `T00:00:00.000Z` is appended explicitly. Without the `Z` the string is
 * parsed as local time by every engine, which is the bug this whole module is
 * built to avoid.
 */
function utcMidnight(date: IsoDate): number {
  assertIsoDate(date);
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

/**
 * Rejects anything that is not a real calendar day.
 *
 * `isIsoDate` catches what the shape cannot: `2026-02-30`, `2026-13-01` and
 * `2025-02-29` all match `YYYY-MM-DD`, and `new Date('2026-02-30')` does not
 * throw — it rolls silently forward to 2 March. A caller reaching this with a
 * bad day has a defect; a request body with one is a 422 from `isoDateSchema`
 * long before it gets here.
 */
function assertIsoDate(value: unknown): asserts value is IsoDate {
  if (!isIsoDate(value)) {
    throw new RangeError(`Not a calendar day as YYYY-MM-DD: ${String(value)}`);
  }
}
