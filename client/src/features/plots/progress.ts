import { CROP_GROWING_DAYS, toIsoDate, type PlotRecord } from '@agrisense/shared';

import { daysBetween, todayIso } from '@/shared/i18n/dates';

/**
 * How far through its season a plot is.
 *
 * **Computed at render time, never stored.** A progress value written to a
 * record is wrong by the next morning and wrong for every farmer who opens the
 * app on a different day; the only honest storage for "how far along" is the
 * planting date it is derived from, which is what `plots.plantedAt` already
 * holds.
 *
 * The season length comes from `CROP_GROWING_DAYS` in `@agrisense/shared`,
 * which mirrors the `totalDays` an agronomist reviews in the server's crop
 * calendar file — the server refuses to boot if the two disagree.
 */
export interface CropStage {
  /** Days since planting, counting planting day as day 1. Clamped to the season. */
  day: number;
  /** The season's length in days, for the crop. */
  total: number;
  /** `day / total`, 0 to 1. What the bar is drawn from. */
  fraction: number;
  /** The season has run its course — the crop is at or past harvest. */
  isComplete: boolean;
  /** The planting day has not arrived yet: a date entered ahead of sowing. */
  isFuture: boolean;
}

/**
 * The plot's stage today, or `null` when nothing is in the ground.
 *
 * `today` is passed in rather than read here so a list renders every card
 * against one day, and so this is testable without mocking the clock.
 *
 * `plantedAt` is an instant holding a day — written as UTC midnight of the day
 * the farmer picked — so it is read back in UTC and nowhere else. Reading it
 * in the device's zone is what would put a plot a day further along than it is
 * for everyone west of Colombo.
 */
export function cropStage(plot: PlotRecord, today: string = todayIso()): CropStage | null {
  // `== null`: the API sends `null` for an unplanted plot, and an older
  // document may have no key at all.
  if (plot.plantedAt == null) {
    return null;
  }

  const total = CROP_GROWING_DAYS[plot.crop];
  const elapsed = daysBetween(toIsoDate(plot.plantedAt), today);

  if (Number.isNaN(elapsed)) {
    return null;
  }

  const day = Math.min(Math.max(elapsed + 1, 0), total);

  return {
    day,
    total,
    fraction: total === 0 ? 0 : day / total,
    isComplete: elapsed + 1 >= total,
    isFuture: elapsed < 0,
  };
}
