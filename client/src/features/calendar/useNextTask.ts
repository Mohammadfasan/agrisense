import type { CalendarTaskRecord } from '@agrisense/shared';

import { useCalendarStore } from './calendarStore';
import { nextDueTask } from './grouping';

/**
 * The next thing due on one plot, for the card on `/plots`.
 *
 * Two sources, in order of what the device actually knows:
 *
 * 1. That plot's own calendar, if the farmer has opened it. Complete, so the
 *    answer is exact.
 * 2. Otherwise the cross-plot `upcoming` list, which one request fills for
 *    every plot at once. It reaches {@link UPCOMING_WINDOW_DAYS} ahead, so a
 *    plot whose next job is a month out has no line on its card — which is the
 *    right trade for a list screen: showing "next: harvest, in 74 days" on
 *    every card is noise, and fetching a calendar per plot to find out is a
 *    request per card.
 *
 * Deliberately not a fetch. The screens that use this already load `upcoming`
 * for their own reasons; a hook that fetched would make a list of ten cards
 * ten requests.
 */
export function useNextTask(plotId: string): CalendarTaskRecord | null {
  const loaded = useCalendarStore((state) => state.byPlot[plotId]);
  const upcoming = useCalendarStore((state) => state.upcoming);

  if (loaded !== undefined) {
    return nextDueTask(loaded);
  }
  // Already sorted by day, and already filtered to outstanding work by the
  // server, so the first match is the answer.
  return upcoming.find((task) => task.plotId === plotId) ?? null;
}
