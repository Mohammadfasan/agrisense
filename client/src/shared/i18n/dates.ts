import type { IsoDate } from '@agrisense/shared';

import i18n from './index';

/**
 * Days, as a farmer reads them.
 *
 * The API speaks in `YYYY-MM-DD` strings and so does this module: nothing here
 * constructs a `Date` from a task's date, compares one, or hands one to
 * `toLocaleDateString`. Sri Lanka is UTC+05:30, and every one of those routes
 * ends with a task drawn a day early. `@agrisense/shared`'s `domain/dates.ts`
 * has the full reasoning; this is the display half of the same rule.
 *
 * **Month names come from the catalogues, not from `Intl`.** `Intl` would be
 * the obvious choice and cannot be relied on here: the Android WebViews this
 * app targets ship trimmed ICU data, and a device that has no Sinhala calendar
 * silently answers in English — which looks like a working app to everyone
 * testing it and like a broken one to the farmer holding it. Twelve translated
 * strings per language are cheap, and they are the same three catalogues every
 * other word on the screen comes from.
 *
 * The order of day, month and year is a catalogue string too
 * (`date.format.short`), because it is not the same in every language.
 */

/** `YYYY-MM-DD` for a `Date`, read in the device's own zone. */
function toLocalIsoDate(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today, where the phone is.
 *
 * Local parts and not `toISOString`, which would be yesterday for the whole
 * Sri Lankan morning: at 09:00 in Colombo it is still 03:30 UTC, and reading
 * the UTC day would put every "today" task under "overdue" until half past
 * five in the morning... and the reverse after 18:30. Read the local parts and
 * neither happens.
 */
export function todayIso(): IsoDate {
  return toLocalIsoDate(new Date());
}

/**
 * Whole days from `from` to `to`; negative when `to` is the earlier one.
 *
 * Both are parsed as UTC midnight — not as local midnight — so the difference
 * is exact whatever zone the device is in and whatever daylight saving it
 * thinks it observes. The values are days either way; UTC is only the arena
 * the subtraction happens in.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return Number.NaN;
  }
  return Math.round((end - start) / 86_400_000);
}

/** The day `days` after `date`, as `YYYY-MM-DD`. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const start = Date.parse(`${date}T00:00:00.000Z`);

  if (Number.isNaN(start)) {
    return date;
  }
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A day, written out: `15 Mar` this year, `15 Mar 2027` beyond it.
 *
 * The year is dropped inside the current year because a calendar screen is
 * almost entirely this season, and four digits on every row is four digits of
 * noise. It comes back the moment it carries information.
 */
export function formatDay(date: IsoDate, today: IsoDate = todayIso()): string {
  const [year, month, day] = date.split('-');

  if (year === undefined || month === undefined || day === undefined) {
    return date;
  }

  const monthName = i18n.t(`date.month.${Number(month)}`, {
    defaultValue: MONTH_FALLBACKS[Number(month) - 1] ?? month,
  });
  const sameYear = date.slice(0, 4) === today.slice(0, 4);

  return i18n.t(sameYear ? 'date.format.short' : 'date.format.long', {
    defaultValue: sameYear ? '{{day}} {{month}}' : '{{day}} {{month}} {{year}}',
    // Leading zero stripped: nobody says "the 05th".
    day: String(Number(day)),
    month: monthName,
    year,
  });
}

/**
 * A day, as a farmer would say it out loud.
 *
 * "Today" and "tomorrow" for the two days that decide what happens next, and a
 * date for everything else. Deliberately only two: "in 3 days" reads as
 * precision the reader then has to do arithmetic on, while a farmer planning a
 * week wants the date they will see on their phone that morning.
 *
 * Yesterday is a date too, not "yesterday". An overdue task is already marked
 * as overdue on the row; softening the day it was due would work against that.
 */
export function formatDayRelative(date: IsoDate, today: IsoDate = todayIso()): string {
  switch (daysBetween(today, date)) {
    case 0:
      return i18n.t('date.today', 'Today');
    case 1:
      return i18n.t('date.tomorrow', 'Tomorrow');
    default:
      return formatDay(date, today);
  }
}

/**
 * English month abbreviations, as the fallback when a catalogue has no
 * `date.month.*` — which, for English, is also the answer.
 */
const MONTH_FALLBACKS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
