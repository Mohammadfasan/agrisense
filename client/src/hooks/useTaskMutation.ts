import type { CalendarTaskRecord, CalendarToday, TaskStatus } from '@agrisense/shared';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  calendarKeys,
  conflictingTask,
  patchTaskStatus,
  tasksWithTask,
  todayWithTask,
} from '@/api/calendar';
import { statusErrorMessage } from '@/features/calendar/errors';
import { showToast } from '@/shared/components/toastStore';
import { todayIso } from '@/shared/i18n/dates';

/**
 * Moving a task between `pending`, `done` and `skipped`, from anywhere.
 *
 * **Optimistic, because of where this is used.** A farmer ticks a task off
 * standing in the field on a connection that may take four seconds to answer
 * or may never answer at all. A row that waits for the server before it
 * changes is a row they tap twice; so the cache changes first, the request
 * follows, and a failure puts the row back the way it was with a message
 * saying why.
 *
 * **It knows nothing about any screen.** No plot id, no bucket, no list — it
 * is handed a task and a status, and it writes the result into every cached
 * calendar query it can find under `calendarKeys.all`. A screen added later is
 * kept in step by having used those keys. That is not tidiness: Week 6's
 * offline sync replays queued writes with no component mounted at all, and it
 * needs exactly this — the version check, the conflict handling and the cache
 * update — without a screen to hang it on.
 *
 * **`version` is the argument that matters.** It is the version this device
 * last saw, and the server refuses the write if it is not the stored one. Two
 * phones holding the same calendar offline will both tick the same task; this
 * is what makes the second one a conversation rather than a silent overwrite.
 */

export interface TaskStatusChange {
  /** The task as this device currently holds it, `version` included. */
  task: CalendarTaskRecord;
  status: TaskStatus;
}

/** The cache entries as they were before the optimistic write, for the undo. */
interface Rollback {
  entries: [QueryKey, unknown][];
}

export function useTaskMutation(): UseMutationResult<
  CalendarTaskRecord,
  unknown,
  TaskStatusChange,
  Rollback
> {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation<CalendarTaskRecord, unknown, TaskStatusChange, Rollback>({
    mutationFn: ({ task, status }) => patchTaskStatus(task._id, { status, version: task.version }),

    onMutate: async ({ task, status }) => {
      // A refetch in flight would land after the optimistic write and undo it
      // with data fetched before it. Cancel first, then snapshot.
      await queryClient.cancelQueries({ queryKey: calendarKeys.all });
      const entries = queryClient.getQueriesData({ queryKey: calendarKeys.all });

      applyTask(queryClient, optimistic(task, status));

      return { entries };
    },

    onSuccess: (saved) => {
      // The server's copy, with the real `version`, `completedAt` and the
      // `isUserEdited` it set. Without this the next tick would send the
      // version the optimistic record guessed at and lose the race on purpose.
      applyTask(queryClient, saved);
    },

    onError: (cause, _variables, context) => {
      for (const [key, data] of context?.entries ?? []) {
        queryClient.setQueryData(key, data);
      }

      // A `409` carries the server's current record, so the row can be
      // corrected in place instead of springing back to a value that is also
      // wrong. Someone else -- another phone, the same farmer an hour ago --
      // already changed this task, and what they did is what is true.
      const current = conflictingTask(cause);
      if (current !== null) {
        applyTask(queryClient, current);
      }

      showToast(statusErrorMessage(cause, t));
    },
  });
}

/* -------------------------------------------------------------------------- */

/**
 * The task as it will look if the write lands.
 *
 * The three completion fields are derived exactly as the server derives them
 * (`docs/api-spec.md`, the table on the task object), so the optimistic row
 * and the row that comes back agree: `done` carries both the day and the
 * instant, `skipped` carries only the instant, `pending` carries neither.
 * `completedOn` is the *phone's* day, because the phone is where the farmer is
 * standing -- the server's own fallback is today in Colombo for the same
 * reason.
 *
 * `version` is deliberately left alone. Only the server may bump it, and a
 * guess here would be sent as fact by the next tick.
 */
function optimistic(task: CalendarTaskRecord, status: TaskStatus): CalendarTaskRecord {
  return {
    ...task,
    status,
    completedOn: status === 'done' ? todayIso() : null,
    completedAt: status === 'pending' ? null : new Date(),
    // Any touch takes a task out of the generator's reach on a rebuild, and
    // the server sets this on every status write.
    isUserEdited: true,
  };
}

/**
 * Writes one task into every cached calendar query that holds it.
 *
 * Two shapes, told apart by their key rather than by sniffing the data:
 * `/calendar/today` answers with three buckets, and a plot's calendar with a
 * flat list. Each is applied by the helper in `api/calendar.ts` that knows the
 * server's own rule for what belongs in it.
 */
function applyTask(queryClient: QueryClient, task: CalendarTaskRecord): void {
  queryClient.setQueriesData<CalendarToday>({ queryKey: calendarKeys.todays }, (data) =>
    data === undefined ? data : todayWithTask(data, task),
  );
  queryClient.setQueriesData<CalendarTaskRecord[]>({ queryKey: calendarKeys.plots }, (data) =>
    data === undefined ? data : tasksWithTask(data, task),
  );
}
