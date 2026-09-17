import {
  calendarTaskSchema,
  type CalendarTaskInput,
  type CalendarTaskRecord,
} from '@agrisense/shared';
import { z } from 'zod';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth';
import { newUuid } from '@/lib/uuid';
import { api, getApiErrorCode } from '@/shared/api/client';
import { addDays, todayIso } from '@/shared/i18n/dates';

/**
 * The farmer's crop calendar, as this device currently understands it.
 *
 * Two collections, because the app asks two different questions of the same
 * endpoint and neither answer is a subset of the other:
 *
 * - `byPlot` is one plot's whole calendar, completed work included. It is what
 *   `/plots/:id/calendar` reads, and it is keyed by plot because a farmer
 *   moving between plots should not re-fetch the one they just looked at.
 * - `upcoming` is what is still to do across every plot, which the home screen
 *   shows. The server decides what qualifies -- outstanding, and not beyond
 *   the window -- so this is deliberately not computed by filtering `byPlot`:
 *   that would only ever cover the plots this device happens to have opened.
 *
 * Both are kept in step by hand on every write ({@link mergeTask}), because a
 * task completed on the calendar screen has to leave the home screen's list
 * without a round trip.
 *
 * Nothing here is persisted. Offline tasks are Week 6 work and belong in the
 * Dexie outbox, not in a second copy of the calendar that would then have to
 * be reconciled with it -- the same reasoning as `plotStore`.
 */

const taskListResponseSchema = z.object({ tasks: z.array(calendarTaskSchema) });
const taskResponseSchema = z.object({ task: calendarTaskSchema });

/** How a load went. `idle` is "nobody has asked yet". */
export type TaskListStatus = 'idle' | 'loading' | 'ready' | 'error';

/** How many days ahead the home screen's list reaches. */
export const UPCOMING_WINDOW_DAYS = 14;

interface CalendarState {
  /** Keyed by plot id, each in `dueDate` order. Only plots that were opened. */
  byPlot: Record<string, CalendarTaskRecord[]>;
  plotStatus: Record<string, TaskListStatus>;
  /** The API's error code for a failed load, per plot. See `errors.ts`. */
  plotError: Record<string, string | null>;

  /** Outstanding work across every plot, earliest first. */
  upcoming: CalendarTaskRecord[];
  upcomingStatus: TaskListStatus;
  upcomingError: string | null;

  /** (Re)loads one plot's calendar. Never rejects; failure lands in the map. */
  fetchForPlot: (plotId: string) => Promise<void>;
  /** Loads a plot's calendar only if nothing has, for a screen's mount. */
  ensureLoadedForPlot: (plotId: string) => Promise<void>;
  /** (Re)loads the cross-plot list. Never rejects. */
  fetchUpcoming: () => Promise<void>;
  /** Loads the cross-plot list only if nothing has. */
  ensureUpcoming: () => Promise<void>;

  /**
   * Creates a task under an id minted here, before the request goes out.
   * Rejects with the API's error.
   */
  createTask: (input: CalendarTaskInput) => Promise<CalendarTaskRecord>;
  /** `PUT` — creates or replaces the whole task. Rejects with the API's error. */
  saveTask: (id: string, input: CalendarTaskInput) => Promise<CalendarTaskRecord>;
  /**
   * Ticks a task off, on the day the *phone* thinks it is. Sent explicitly
   * rather than left to the server, which is in UTC and would file anything
   * done after 18:30 Colombo time under yesterday.
   */
  completeTask: (id: string) => Promise<CalendarTaskRecord>;
  /** Un-ticks one. `PATCH`, because only a patch can state `completedOn: null`. */
  reopenTask: (id: string) => Promise<CalendarTaskRecord>;
  /** Soft-deletes on the server and drops it here. Rejects with the API's error. */
  deleteTask: (id: string) => Promise<void>;
  /** Back to empty, with nothing loaded. */
  reset: () => void;
}

const EMPTY = {
  byPlot: {},
  plotStatus: {},
  plotError: {},
  upcoming: [],
  upcomingStatus: 'idle' as TaskListStatus,
  upcomingError: null,
} satisfies Partial<CalendarState>;

export const useCalendarStore = create<CalendarState>()((set, get) => ({
  ...EMPTY,

  fetchForPlot: async (plotId) => {
    set((state) => ({
      plotStatus: { ...state.plotStatus, [plotId]: 'loading' },
      plotError: { ...state.plotError, [plotId]: null },
    }));

    try {
      const { data } = await api.get<unknown>('/calendar', { params: { plotId } });
      const { tasks } = taskListResponseSchema.parse(data);
      set((state) => ({
        byPlot: { ...state.byPlot, [plotId]: tasks },
        plotStatus: { ...state.plotStatus, [plotId]: 'ready' },
      }));
    } catch (cause) {
      set((state) => ({
        plotStatus: { ...state.plotStatus, [plotId]: 'error' },
        plotError: { ...state.plotError, [plotId]: getApiErrorCode(cause) ?? 'UNKNOWN' },
      }));
    }
  },

  ensureLoadedForPlot: async (plotId) => {
    // Deliberately not retried after a failure: the screen offers a retry
    // button, and re-requesting on every mount would hammer a dead connection
    // every time the farmer stepped back to the calendar.
    if ((get().plotStatus[plotId] ?? 'idle') === 'idle') {
      await get().fetchForPlot(plotId);
    }
  },

  fetchUpcoming: async () => {
    set({ upcomingStatus: 'loading', upcomingError: null });
    try {
      const { data } = await api.get<unknown>('/calendar/upcoming', {
        params: { days: UPCOMING_WINDOW_DAYS },
      });
      const { tasks } = taskListResponseSchema.parse(data);
      set({ upcoming: tasks, upcomingStatus: 'ready', upcomingError: null });
    } catch (cause) {
      set({ upcomingStatus: 'error', upcomingError: getApiErrorCode(cause) ?? 'UNKNOWN' });
    }
  },

  ensureUpcoming: async () => {
    if (get().upcomingStatus === 'idle') {
      await get().fetchUpcoming();
    }
  },

  createTask: async (input) => {
    // The id exists before the request does, which is the whole point of ADR
    // 001: the task has an address the moment it is thought of, so a `PUT`
    // replayed after a dropped connection lands on it rather than beside it.
    return get().saveTask(newUuid(), input);
  },

  saveTask: async (id, input) => {
    const { data } = await api.put<unknown>(`/calendar/${id}`, input);
    const { task } = taskResponseSchema.parse(data);
    set(mergeTask(task));
    return task;
  },

  completeTask: async (id) => {
    const { data } = await api.post<unknown>(`/calendar/${id}/complete`, {
      completedOn: todayIso(),
    });
    const { task } = taskResponseSchema.parse(data);
    set(mergeTask(task));
    return task;
  },

  reopenTask: async (id) => {
    const { data } = await api.patch<unknown>(`/calendar/${id}`, { completedOn: null });
    const { task } = taskResponseSchema.parse(data);
    set(mergeTask(task));
    return task;
  },

  deleteTask: async (id) => {
    await api.delete(`/calendar/${id}`);
    set(dropTask(id));
  },

  reset: () => {
    set(EMPTY);
  },
}));

/* -------------------------------------------------------------------------- */

/**
 * Puts a written task into both collections.
 *
 * `upcoming` is filtered as well as merged, because the server's rule for what
 * belongs in it is a rule this device has to be able to apply on its own:
 * completing a task must take it off the home screen immediately, not at the
 * next fetch. A task that was not in the list and is still outstanding is
 * added -- a new one, created on the calendar screen, belongs there too.
 */
function mergeTask(task: CalendarTaskRecord) {
  return (state: CalendarState): Partial<CalendarState> => {
    const existing = state.byPlot[task.plotId];
    const withinWindow = task.dueDate <= addDays(todayIso(), UPCOMING_WINDOW_DAYS);

    return {
      // Only for a plot whose calendar has actually been loaded. Seeding a
      // one-task list for a plot nobody has opened would read as "this plot
      // has one task" on the screen that opens next.
      byPlot:
        existing === undefined
          ? state.byPlot
          : { ...state.byPlot, [task.plotId]: sortByDay(replace(existing, task)) },
      upcoming:
        task.completedOn === null && withinWindow
          ? sortByDay(replace(state.upcoming, task))
          : state.upcoming.filter((candidate) => candidate._id !== task._id),
    };
  };
}

function dropTask(id: string) {
  return (state: CalendarState): Partial<CalendarState> => ({
    byPlot: Object.fromEntries(
      Object.entries(state.byPlot).map(([plotId, tasks]) => [
        plotId,
        tasks.filter((task) => task._id !== id),
      ]),
    ),
    upcoming: state.upcoming.filter((task) => task._id !== id),
  });
}

function replace(tasks: readonly CalendarTaskRecord[], task: CalendarTaskRecord) {
  return [...tasks.filter((candidate) => candidate._id !== task._id), task];
}

/**
 * `dueDate` ascending, `_id` breaking the tie — the order the API sorts in, so
 * a locally merged task lands where a re-fetch would put it. String comparison
 * is exact here: `YYYY-MM-DD` sorts lexically in the order it sorts by date.
 */
function sortByDay(tasks: CalendarTaskRecord[]): CalendarTaskRecord[] {
  return [...tasks].sort((a, b) =>
    a.dueDate === b.dueDate ? a._id.localeCompare(b._id) : a.dueDate.localeCompare(b.dueDate),
  );
}

// Tasks belong to an account, not to a device. Without this, signing out and
// back in on a shared phone — which here is the normal case rather than the
// edge one — would show the previous farmer's calendar until the next fetch
// landed. The same subscription `plotStore` makes, for the same reason.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    useCalendarStore.getState().reset();
  }
});
