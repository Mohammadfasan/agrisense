import type { CalendarTaskRecord } from '@agrisense/shared';

import { daysBetween, todayIso } from '@/shared/i18n/dates';

/**
 * How a plot's calendar is cut up on screen.
 *
 * Four buckets and no more, because they answer four different questions a
 * farmer standing in the field is actually asking: what did I miss, what am I
 * doing now, what is coming before the week is out, and what is further off.
 * A month grid would be prettier and would answer none of them on a 360px
 * screen held at arm's length.
 *
 * Completed work is pulled out of all four and collapsed underneath. It is
 * kept — the calendar is a record of the season as well as a plan — but a
 * ticked task is not something to do, and leaving it in the list would bury
 * the two rows that are.
 */
export type TaskBucket = 'overdue' | 'today' | 'week' | 'later';

/** In the order they are shown. Overdue first: it is the most urgent thing. */
export const TASK_BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'week', 'later'];

export interface GroupedTasks {
  /** Outstanding work, by bucket, each in `dueDate` order. */
  outstanding: Readonly<Record<TaskBucket, CalendarTaskRecord[]>>;
  /** Done, most recently completed first. */
  completed: CalendarTaskRecord[];
  /** True when every bucket is empty — the empty state, not a loading one. */
  isEmpty: boolean;
}

/**
 * Splits a plot's tasks into the buckets above.
 *
 * `today` is the device's local day and is passed in rather than read here, so
 * a screen renders one consistent "today" across every row even if it is open
 * across midnight, and so this is testable without mocking the clock.
 *
 * "This week" is the next seven days, counted from tomorrow. Not the calendar
 * week: a farmer on a Saturday does not think of a job on Monday as "next
 * week", they think of it as in two days.
 */
export function groupTasks(
  tasks: readonly CalendarTaskRecord[],
  today: string = todayIso(),
): GroupedTasks {
  const outstanding: Record<TaskBucket, CalendarTaskRecord[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
  };
  const completed: CalendarTaskRecord[] = [];

  for (const task of tasks) {
    if (task.completedOn !== null) {
      completed.push(task);
      continue;
    }
    outstanding[bucketFor(task.dueDate, today)].push(task);
  }

  for (const bucket of TASK_BUCKETS) {
    outstanding[bucket].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
  // Most recent first: what was finished this morning is more interesting than
  // what was finished in March.
  completed.sort((a, b) => (b.completedOn ?? '').localeCompare(a.completedOn ?? ''));

  return {
    outstanding,
    completed,
    isEmpty: tasks.length === 0,
  };
}

/** Which bucket a day falls in, relative to today. */
export function bucketFor(dueDate: string, today: string): TaskBucket {
  const days = daysBetween(today, dueDate);

  if (Number.isNaN(days)) {
    // A date this app cannot read is not silently dropped: it goes where it
    // will be looked at.
    return 'later';
  }
  if (days < 0) {
    return 'overdue';
  }
  if (days === 0) {
    return 'today';
  }
  return days <= 7 ? 'week' : 'later';
}

/**
 * The next thing due on a plot, for the card on `/plots`.
 *
 * The earliest outstanding task, overdue ones included — a job that was missed
 * is still the next thing to do, and it is the one worth showing. `null` when
 * there is nothing outstanding at all.
 */
export function nextDueTask(tasks: readonly CalendarTaskRecord[]): CalendarTaskRecord | null {
  return tasks
    .filter((task) => task.completedOn === null)
    .reduce<CalendarTaskRecord | null>(
      (earliest, task) => (earliest === null || task.dueDate < earliest.dueDate ? task : earliest),
      null,
    );
}
