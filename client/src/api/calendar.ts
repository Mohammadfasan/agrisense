import {
  calendarTaskSchema,
  calendarTodaySchema,
  isoDateSchema,
  uuidV4Schema,
  type CalendarGenerateInput,
  type CalendarTaskRecord,
  type CalendarTaskStatusInput,
  type CalendarToday,
  type IsoDate,
} from '@agrisense/shared';
import { z } from 'zod';

import { api, getApiErrorCode, getApiErrorDetails } from '@/shared/api/client';

/**
 * The Day 12 calendar endpoints, as typed calls.
 *
 * A module of functions rather than a store, unlike `calendarStore`: these
 * surfaces are read through react-query, which owns the caching, the retry
 * policy and — the reason it is worth the split — the optimistic write in
 * `useTaskMutation`. Nothing here holds state or knows a screen exists.
 *
 * Every response is parsed before it is returned, with the same schemas the
 * server validated it against (`@agrisense/shared`). A field the API stopped
 * sending fails here, at the boundary, rather than three components later as
 * an undefined read.
 *
 * The axios instance is the app's one instance: it attaches the bearer token,
 * mints the `X-Request-Id` the API echoes into its logs, and refreshes and
 * replays a request whose token expired mid-flight. A second instance would
 * have none of that.
 */

/* -------------------------------------------------------------------------- */
/* Query keys                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every calendar query hangs off `['calendar']`.
 *
 * The prefix is not decoration. `useTaskMutation` writes a ticked task into
 * every cached calendar query without being told which screens are mounted,
 * and it finds them by that prefix — so a calendar screen added later is kept
 * in step by having used these keys, and by nothing else.
 */
export const calendarKeys = {
  all: ['calendar'] as const,
  /** Every `/calendar/today` query, whatever day it asked about. */
  todays: ['calendar', 'today'] as const,
  /** `/calendar/today`, keyed by the day the buckets were asked for. */
  today: (date: IsoDate) => [...calendarKeys.todays, date] as const,
  /** Every plot calendar query. */
  plots: ['calendar', 'plot'] as const,
  /** One plot's whole calendar, completed work included. */
  plot: (plotId: string) => [...calendarKeys.plots, plotId] as const,
};

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

const taskListResponseSchema = z.object({ tasks: z.array(calendarTaskSchema) });

const taskResponseSchema = z.object({ task: calendarTaskSchema });

/**
 * `POST /plots/:plotId/calendar/generate`. Declared here rather than in
 * `@agrisense/shared` because it is a response shape and the shared package
 * publishes the request one; `supersededCount` is the only field in it the
 * server invents.
 */
const generateResponseSchema = z.object({
  tasks: z.array(calendarTaskSchema),
  generationBatchId: uuidV4Schema,
  sowingDate: isoDateSchema,
  supersededCount: z.number().int().min(0),
});

export interface GeneratedCalendar extends z.infer<typeof generateResponseSchema> {
  /**
   * `true` when this run wrote the tasks (`201`), `false` when the server
   * recognised the batch id and returned what it had already written (`200`).
   *
   * Worth carrying: it is the difference between "your calendar is ready" and
   * "the request you thought was lost had already landed", and only the status
   * line says which happened — the two bodies are identical.
   */
  created: boolean;
}

/* -------------------------------------------------------------------------- */
/* Calls                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Builds a plot's season from the crop stage templates, and records the sowing
 * date on the plot.
 *
 * **`generationBatchId` must be minted before the first attempt and reused on
 * every retry.** The server is idempotent on that id, not on the request: the
 * same id lands on the tasks it already wrote, and a *new* id means "rebuild"
 * and supersedes the previous batch. A caller that minted a fresh id inside a
 * retry would turn one farmer's lost response into two calendars. See
 * `GenerateSheet`, which mints exactly one per opening of the sheet.
 */
export async function generateCalendar(
  plotId: string,
  input: CalendarGenerateInput,
): Promise<GeneratedCalendar> {
  const response = await api.post<unknown>(`/plots/${plotId}/calendar/generate`, input);

  return { ...generateResponseSchema.parse(response.data), created: response.status === 201 };
}

/**
 * What is late, what is due today and what is coming, across every live plot.
 *
 * `date` is the phone's own day and is sent rather than left to the server.
 * Sri Lanka is UTC+05:30, so for five and a half hours out of every
 * twenty-four a server computing "today" in UTC disagrees with the farmer
 * holding the phone. The server echoes back the day it used, which is what the
 * screen labels its buckets against.
 */
export async function fetchToday(date: IsoDate): Promise<CalendarToday> {
  const { data } = await api.get<unknown>('/calendar/today', { params: { date } });

  return calendarTodaySchema.parse(data);
}

/**
 * Moves one task between `pending`, `done` and `skipped`.
 *
 * `version` is required by the endpoint and is the point of it: two phones
 * holding the same calendar offline will both tick the same task, and the one
 * whose version is stale is told so rather than silently overwriting the
 * other. Rejects with a `409` carrying the current record — see
 * {@link conflictingTask}.
 *
 * `completedOn` and `completedAt` are not sent. The server derives both from
 * `status`, so the three cannot drift apart.
 */
export async function patchTaskStatus(
  taskId: string,
  input: CalendarTaskStatusInput,
): Promise<CalendarTaskRecord> {
  const { data } = await api.patch<unknown>(`/calendar/tasks/${taskId}`, input);

  return taskResponseSchema.parse(data).task;
}

/**
 * One plot's whole calendar, completed work included — the list the plot
 * detail screen groups by stage.
 *
 * Not one of the three Day 12 endpoints, and here anyway: the screen that
 * generates a calendar is the screen that then has to show it, and a read
 * fetched through this module is a read `useTaskMutation` can keep in step.
 */
export async function fetchPlotTasks(plotId: string): Promise<CalendarTaskRecord[]> {
  const { data } = await api.get<unknown>('/calendar', { params: { plotId } });

  return taskListResponseSchema.parse(data).tasks;
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                   */
/* -------------------------------------------------------------------------- */

/** The API's code for a status write that lost a race. */
export const VERSION_CONFLICT = 'CALENDAR_TASK_VERSION_CONFLICT';

/**
 * The server's copy of a task, out of a `409` body.
 *
 * The endpoint attaches the current record to the conflict precisely so that
 * the client does not have to make a second request in the one moment it most
 * needs an answer ready — the farmer is looking at a row that just sprang
 * back. `null` when this was not a version conflict, or when the details did
 * not parse: a malformed conflict is not a task, and inventing one from it
 * would put a record on screen that nothing sent.
 */
export function conflictingTask(cause: unknown): CalendarTaskRecord | null {
  if (getApiErrorCode(cause) !== VERSION_CONFLICT) {
    return null;
  }
  const parsed = calendarTaskSchema.safeParse(getApiErrorDetails(cause)?.task);

  return parsed.success ? parsed.data : null;
}

/* -------------------------------------------------------------------------- */
/* Cache shapes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Puts a written task into a cached list, dropping it if it no longer belongs.
 *
 * `keep` is how the caller states the rule the *server* applies to that list,
 * so an optimistic update agrees with the refetch that follows it rather than
 * flickering when the truth arrives.
 *
 * The task is merged onto the cached row rather than replacing it, because
 * `/calendar/today` joins `plotName` onto each task and a stored task has no
 * such field. Replacing would strip the plot's name off every row the moment
 * it was ticked.
 */
function applyToList<T extends CalendarTaskRecord>(
  tasks: readonly T[],
  task: CalendarTaskRecord,
  keep: (candidate: CalendarTaskRecord) => boolean,
): T[] {
  return tasks.flatMap((candidate) => {
    if (candidate._id !== task._id) {
      return [candidate];
    }
    return keep(task) ? [{ ...candidate, ...task }] : [];
  });
}

/**
 * The same task, applied to a cached `/calendar/today` response.
 *
 * The three buckets are not symmetric and the rules are the server's, quoted
 * from `docs/api-spec.md`: `overdue` and `next7` hold pending work only, so a
 * task ticked off leaves them; `today` holds whatever is due today whatever
 * its status, so the day does not empty out as the farmer works through it.
 */
export function todayWithTask(today: CalendarToday, task: CalendarTaskRecord): CalendarToday {
  const isPending = (candidate: CalendarTaskRecord): boolean => candidate.status === 'pending';

  return {
    ...today,
    overdue: applyToList(today.overdue, task, isPending),
    today: applyToList(today.today, task, () => true),
    next7: applyToList(today.next7, task, isPending),
  };
}

/**
 * The same task, applied to a cached plot calendar. Nothing is dropped here: a
 * plot's calendar is the record of its season as well as the plan, so a
 * completed task stays in it.
 */
export function tasksWithTask(
  tasks: readonly CalendarTaskRecord[],
  task: CalendarTaskRecord,
): CalendarTaskRecord[] {
  return applyToList(tasks, task, () => true);
}
