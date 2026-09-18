import { z } from 'zod';

import { isoDateSchema } from '../domain/dates.js';
import { uuidV4Schema } from '../domain/uuid.js';
import { plotIdSchema } from './plot.js';

/**
 * A crop calendar task — one thing to do on one plot on one day.
 *
 * Built to the same rules as `plotSchema`, and for the same reasons:
 *
 * - The `_id` is a **UUID v4 the client generates** (`docs/architecture.md`,
 *   ADR 001), so `PUT` is the create and a replayed offline write lands on the
 *   task it already made rather than beside it. Server-generated template
 *   tasks use the same id space; only the minting moves.
 * - `userId` appears in no input schema. The owner is the authenticated
 *   caller, and there is no field for a request to claim otherwise with.
 *
 * Two things are specific to this collection.
 *
 * **Dates are days, not instants.** `dueDate` and `completedOn` are
 * `YYYY-MM-DD` strings and never `Date`s — see `domain/dates.ts` for what
 * UTC+05:30 does to the alternative.
 *
 * **`source` and `completedOn` are lifecycle state, not content.** Neither is
 * in the writable set that `PUT` replaces, for the reasons on
 * {@link calendarTaskCreateSchema} and {@link calendarTaskUpdateSchema}.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What kind of work a task is.
 *
 * Shared rather than server-only because the client renders an icon per type
 * and groups a day's work by it, and a type the two halves disagree about is a
 * task that draws as a blank.
 *
 * `fertilising` and `pest_control` are spelled as the brief spells them.
 * `activities.type` in `docs/schema.md` §8 uses `fertilizer` and `pesticide`
 * for the *log* of work actually done; the two lists are deliberately separate
 * — one is a plan, the other a record — and neither should be quietly widened
 * into the other.
 */
export const ACTIVITY_TYPES = [
  'sowing',
  'fertilising',
  'irrigation',
  'pest_control',
  'weeding',
  'harvest',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/**
 * Where a task came from, which decides what may happen to it.
 *
 * `template` tasks are generated from the crop calendar and are owned by the
 * generator: regenerating a plot's calendar deletes and rebuilds the ones that
 * are not yet done. `manual` tasks are the farmer's own and are never touched
 * by it. Nothing a client sends can set this — see
 * {@link calendarTaskCreateSchema}.
 */
export const TASK_SOURCES = ['template', 'manual'] as const;

export type TaskSource = (typeof TASK_SOURCES)[number];

export const taskSourceSchema = z.enum(TASK_SOURCES);

/**
 * Where a task stands.
 *
 * Added in Day 12 alongside calendar generation, and the third value is why it
 * exists. `completedOn` can say a task was done and can say it was not; it has
 * no way to say a farmer looked at it and decided not to do it. A skipped task
 * is not outstanding — it must drop off the "what do I do next" list — and it
 * is not done either, and collapsing the two loses the only information a
 * missed spray leaves behind.
 *
 * `completedOn` is still written, in step, and still means the *day* the work
 * happened. `status` and `completedAt` are the lifecycle and the instant.
 */
export const TASK_STATUSES = ['pending', 'done', 'skipped'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskStatusSchema = z.enum(TASK_STATUSES);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Identifier                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A task id: a lower-cased UUID v4. See `domain/uuid.ts` for why only v4 and
 * why the case is normalised.
 */
export const calendarTaskIdSchema = uuidV4Schema;

export type CalendarTaskId = z.infer<typeof calendarTaskIdSchema>;

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The fields a client may write.
 *
 * Kept as a plain object schema with no refinements so `.partial()` below can
 * still reach it — the same constraint as `plotWritableSchema`.
 */
const calendarTaskWritableSchema = z.object({
  /**
   * The plot this is work on. Checked against the caller's own plots by the
   * service on every write, not merely parsed for shape here.
   */
  plotId: plotIdSchema,
  type: activityTypeSchema,
  /**
   * What to do.
   *
   * For a `manual` task this is what the farmer typed, in whatever language
   * they typed it. For a `template` task it is an **i18n key** — the server
   * has no business choosing which of three languages to store agronomy in,
   * and the farmer may change language after the calendar is generated. The
   * `source` field is what tells a client which it is holding.
   */
  title: z.string().trim().min(1).max(100),
  /** Free text, or — on a template task — the description's i18n key. */
  notes: z.string().trim().max(500).optional(),
  dueDate: isoDateSchema,
  /**
   * When to remind the farmer, as an ISO 8601 instant.
   *
   * **Reserved for Week 9.** The field is stored and returned so that clients
   * and the schema settle before the notification worker exists; nothing reads
   * it, and setting it schedules nothing. An instant rather than a day because
   * a reminder is a moment — "06:00 on the 12th" — which is exactly the thing
   * `dueDate` is not.
   */
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * A task as a client creates or replaces it, for `PUT`.
 *
 * `source` is absent on purpose. A client that could claim `template` could
 * hide a task from regeneration, or hand the generator a task it will delete;
 * the server sets `manual` when it inserts and leaves it alone thereafter.
 *
 * `completedOn` is absent for a different reason. `PUT` replaces content, and
 * whether the work is done is not content — it is lifecycle state, like
 * `version` and `deletedAt`, which `PUT` does not clear either. Without that
 * rule an offline client replaying a two-day-old title edit would silently
 * un-complete a task the farmer has since finished. Completion has its own
 * endpoint, and `PATCH` can state it explicitly.
 */
export const calendarTaskCreateSchema = calendarTaskWritableSchema;

export type CalendarTaskInput = z.infer<typeof calendarTaskCreateSchema>;

/**
 * A partial task, for `PATCH`. An empty object is accepted and changes
 * nothing.
 *
 * `completedOn` *is* here, unlike in the `PUT` body, because a `PATCH` names
 * the field it means: `{"completedOn": null}` is a farmer undoing a tick they
 * did not intend, and there is no other way to express it. An omitted field
 * still leaves completion alone.
 */
export const calendarTaskUpdateSchema = calendarTaskWritableSchema.partial().extend({
  completedOn: isoDateSchema.nullable().optional(),
});

export type CalendarTaskUpdateInput = z.infer<typeof calendarTaskUpdateSchema>;

/**
 * The body of `POST /calendar/:id/complete`.
 *
 * The day is optional and comes from the *client* when given, because the
 * phone knows what day it is where the farmer is standing and a server in UTC
 * does not — after 18:30 UTC the two disagree. The server's fallback is
 * today in Colombo rather than today in UTC, for the same reason.
 */
export const calendarTaskCompleteSchema = z.object({
  completedOn: isoDateSchema.optional(),
});

export type CalendarTaskCompleteInput = z.infer<typeof calendarTaskCompleteSchema>;

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A saved task, as the API returns it — the writable fields plus the ones the
 * server owns.
 *
 * Dates that are days stay strings. `deletedAt`, `createdAt` and `updatedAt`
 * are instants and are coerced, so the same schema parses a response body off
 * the wire on the client and a lean document on the server.
 */
export const calendarTaskSchema = calendarTaskWritableSchema.extend({
  _id: calendarTaskIdSchema,
  /** The owning farmer's ObjectId, rendered as a hex string in JSON. */
  userId: z.string(),
  /**
   * `null` when the task carries no note -- **not** absent. `PUT` replaces the
   * whole task, so an omitted note is written as `null`; the write shape above
   * says `optional()` and the read shape has to say `nullable()`, or every
   * task without a note fails to parse on the client. The same split as
   * `plotSchema.notes`.
   */
  notes: z.string().max(500).nullish(),
  /** Always present on a saved task, `null` until the work is done. */
  completedOn: isoDateSchema.nullable(),
  source: taskSourceSchema,
  /** Where the task stands. `pending` until a farmer says otherwise. */
  status: taskStatusSchema,
  /**
   * The instant the task reached `done` or `skipped`, or `null` while it is
   * `pending`. An instant rather than a day, unlike `completedOn`, because
   * this one records *when the farmer said so* rather than when the work
   * happened — an audit trail, not agronomy. The two are written together and
   * answer different questions.
   */
  completedAt: z.coerce.date().nullable(),
  /**
   * `true` once a farmer has touched this task in any way that regeneration
   * must not undo. Generated tasks start `false`; a manual task is `true` from
   * birth, because the farmer wrote the whole thing.
   */
  isUserEdited: z.boolean(),
  /**
   * The generation run that produced this task, or `null` on a manual one.
   * What makes `POST .../calendar/generate` idempotent, and what tells one
   * regeneration's output from the previous one's.
   */
  generationBatchId: uuidV4Schema.nullable(),
  reminderAt: z.string().datetime({ offset: true }).nullable(),
  /**
   * Bumped on every write, including the soft delete. The client compares it
   * to the version it last saw to decide whether its offline copy is stale.
   */
  version: z.number().int().min(1),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type CalendarTaskRecord = z.infer<typeof calendarTaskSchema>;

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How many tasks one request may return.
 *
 * There is no cursor here, unlike `GET /plots`: a calendar request is already
 * bounded by the window a screen is showing — a month, a week — and paging a
 * date range is the client asking for a narrower range. The cap exists so that
 * "every task I have ever had" is still a bounded response.
 */
export const CALENDAR_PAGE_SIZE_DEFAULT = 200;
export const CALENDAR_PAGE_SIZE_MAX = 500;

/**
 * Query string for `GET /calendar`.
 *
 * `from` and `to` are **inclusive at both ends**, which is what a farmer means
 * by "the 1st to the 7th" and what a month view asks for. Because days are
 * `YYYY-MM-DD` strings, that is a plain `$gte`/`$lte` on the string: lexical
 * order on this format is chronological order.
 */
export const calendarListQuerySchema = z
  .object({
    plotId: plotIdSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CALENDAR_PAGE_SIZE_MAX)
      .default(CALENDAR_PAGE_SIZE_DEFAULT),
  })
  .superRefine((query, ctx) => {
    // An empty list would be a defensible answer, and a worse one: a client
    // that swapped its two parameters gets a screen that says "nothing due"
    // rather than a message saying what it asked for.
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'must not be before from',
      });
    }
  });

export type CalendarListQuery = z.infer<typeof calendarListQuerySchema>;

export const CALENDAR_UPCOMING_DAYS_DEFAULT = 7;
export const CALENDAR_UPCOMING_DAYS_MAX = 90;

/** Query string for `GET /calendar/upcoming`. */
export const calendarUpcomingQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(CALENDAR_UPCOMING_DAYS_MAX)
    .default(CALENDAR_UPCOMING_DAYS_DEFAULT),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CALENDAR_PAGE_SIZE_MAX)
    .default(CALENDAR_PAGE_SIZE_DEFAULT),
});

export type CalendarUpcomingQuery = z.infer<typeof calendarUpcomingQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Generation (Day 12)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The body of `POST /plots/:plotId/calendar/generate`.
 *
 * **`generationBatchId` comes from the client, and that is what makes the
 * endpoint idempotent.** A phone that fires the request, loses signal before
 * the response and retries sends the same batch id; the server finds the tasks
 * it already wrote under it and returns them, rather than generating a second
 * calendar beside the first. A *new* batch id is the farmer deliberately
 * asking for the calendar to be rebuilt — usually because they corrected the
 * sowing date — and only then is the previous batch cleared away.
 *
 * It is a UUID v4 for the same reason every other id here is: the client mints
 * it offline, before the server has heard of the run.
 */
export const calendarGenerateSchema = z.object({
  sowingDate: isoDateSchema,
  generationBatchId: uuidV4Schema,
});

export type CalendarGenerateInput = z.infer<typeof calendarGenerateSchema>;

/**
 * Query string for `GET /calendar/today`.
 *
 * `date` is optional and comes from the *client* when given, because the phone
 * knows what day it is where the farmer is standing and a server in UTC does
 * not — after 18:30 UTC the two disagree. The server's fallback is today in
 * Colombo rather than today in UTC, for the same reason as
 * {@link calendarTaskCompleteSchema}.
 */
export const calendarTodayQuerySchema = z.object({
  date: isoDateSchema.optional(),
});

export type CalendarTodayQuery = z.infer<typeof calendarTodayQuerySchema>;

/**
 * The body of `PATCH /calendar/tasks/:id`.
 *
 * **`version` is required, and it is the whole point of the endpoint.** Two
 * phones holding the same calendar offline will both tick the same task; the
 * one whose `version` no longer matches what is stored is told so — `409`,
 * with the current record attached — instead of silently overwriting the
 * other's answer. A farmer can then be shown what actually happened rather
 * than a screen that quietly disagrees with their neighbour's.
 *
 * Nothing else is writable here. `completedAt` and `completedOn` are derived
 * from `status` by the server: a client that could set them could record work
 * as done on a day it was not, and the pair would drift apart.
 */
export const calendarTaskStatusSchema = z.object({
  status: taskStatusSchema,
  /** The version the client believes it is updating. */
  version: z.number().int().min(1),
});

export type CalendarTaskStatusInput = z.infer<typeof calendarTaskStatusSchema>;

/**
 * One task as `/calendar/today` returns it: the stored task plus the name of
 * the plot it is on, joined in the aggregation rather than fetched per task.
 *
 * The name and not the whole plot. A farmer reading "spray the upper field"
 * needs to know which field; they do not need its boundary polygon, and
 * shipping one per task would dwarf the response.
 */
export const calendarTodayTaskSchema = calendarTaskSchema.extend({
  plotName: z.string(),
});

export type CalendarTodayTask = z.infer<typeof calendarTodayTaskSchema>;

/**
 * The three buckets `/calendar/today` answers with.
 *
 * Buckets rather than one sorted list, because the client renders three
 * headings and would otherwise have to re-derive them from `dueDate` against a
 * "today" it computed itself — which is the disagreement about what day it is
 * that this whole module exists to prevent.
 */
export const calendarTodaySchema = z.object({
  /** The day the buckets were computed against. Echoed so the client can tell. */
  date: isoDateSchema,
  /** Due before `date` and still pending. The most urgent thing a farmer owns. */
  overdue: z.array(calendarTodayTaskSchema),
  /** Due on `date`, whatever their status. */
  today: z.array(calendarTodayTaskSchema),
  /** Due in the seven days after `date` and still pending. */
  next7: z.array(calendarTodayTaskSchema),
});

export type CalendarToday = z.infer<typeof calendarTodaySchema>;
