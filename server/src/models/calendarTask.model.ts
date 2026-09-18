import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  ACTIVITY_TYPES,
  ISO_DATE_PATTERN,
  TASK_SOURCES,
  TASK_STATUSES,
  type ActivityType,
  type IsoDate,
  type TaskSource,
  type TaskStatus,
} from '@shared/types';

/**
 * `calendarTasks` — one thing to do, on one plot, on one day.
 *
 * Built on the same terms as `plots` (§4): the `_id` is a **UUID v4** rather
 * than an ObjectId, `version` and `deletedAt` exist for the offline sync, and
 * a delete is a tombstone so a replayed create cannot resurrect it. The one
 * difference in how ids arrive is that some tasks are minted here rather than
 * on a phone — the crop calendar generates them — and they use the same id
 * space, because a client cannot be asked to care which end made a task.
 *
 * **`dueDate` and `completedOn` are `String`, not `Date`, and that is
 * load-bearing.** A task is a day: "top-dress on 12 June" has no hour on it.
 * Sri Lanka is UTC+05:30, so a `Date` at local midnight stores as 18:30 the
 * previous day, and the farmer sees every task a day early. Storing the day as
 * `YYYY-MM-DD` removes the question: lexical order on that format is
 * chronological order, so range queries and index sorts work on the string
 * unchanged. `@agrisense/shared`'s `domain/dates.ts` has the full reasoning
 * and is where the format is validated on the request path.
 */

/** Mirrors `calendarTaskIdSchema`, as `plot.model` mirrors `plotIdSchema`. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CalendarTask {
  /** UUID v4, lower case. Client-generated, or minted by the generator. */
  _id: string;
  /** ref `farmers`. Never read from a request body — see `calendarTask.service`. */
  userId: Types.ObjectId;
  /** ref `plots`. A UUID string, not an ObjectId, because `plots._id` is one. */
  plotId: string;
  type: ActivityType;
  /**
   * What to do. Free text on a `manual` task; an **i18n key** on a `template`
   * one, because the server has no business choosing which of three languages
   * to store agronomy in. `source` is what tells the two apart.
   */
  title: string;
  /** Free text, or the description's i18n key on a template task. */
  notes?: string | null;
  /** `YYYY-MM-DD`. The day the work is due. */
  dueDate: IsoDate;
  /** `YYYY-MM-DD`, or null while the work is outstanding. */
  completedOn?: IsoDate | null;
  /**
   * Where the task stands, added Day 12.
   *
   * `completedOn` above could already say done or not-done; what it had no way
   * to say is that a farmer looked at a task and decided against it. A skipped
   * task is not outstanding and is not done, and folding it into either loses
   * the only trace a missed spray leaves. The two are written together and
   * never independently -- see `calendarTask.service.setStatus`.
   */
  status: TaskStatus;
  /**
   * The instant the task left `pending`, or null while it is there.
   *
   * An instant, unlike `completedOn`, and deliberately: this records *when the
   * farmer said so*, which is an audit trail, while `completedOn` records the
   * day the work happened, which is agronomy. A farmer ticking off Tuesday's
   * spray on Thursday evening produces two different and both correct values.
   */
  completedAt?: Date | null;
  /**
   * `true` once a farmer has touched this task in a way regeneration must not
   * undo.
   *
   * The generator sets `false`; every farmer-facing write sets `true`. It is
   * what lets a rebuild clear the plan without clearing the farmer's own
   * corrections to it -- a stronger guarantee than `completedOn` alone, which
   * only protects work already finished.
   */
  isUserEdited: boolean;
  /**
   * The generation run that produced this task, or null on a manual one.
   *
   * Client-minted, like every other id here, and what makes
   * `POST /plots/:plotId/calendar/generate` idempotent: a retried request
   * carrying the same batch id finds its own tasks and returns them instead of
   * writing a second calendar beside the first.
   */
  generationBatchId?: string | null;
  source: TaskSource;
  /**
   * ISO 8601 instant, or null.
   *
   * **Reserved for Week 9 notifications.** Stored and returned so the contract
   * settles before the worker exists; nothing reads it and setting it
   * schedules nothing. An instant rather than a day because a reminder is a
   * moment, which is exactly what `dueDate` is not.
   */
  reminderAt?: string | null;
  /** Incremented on every write, including the soft delete. */
  version: number;
  /** Soft delete. A tombstone keeps the UUID reserved against re-creation. */
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CalendarTaskDocument = HydratedDocument<CalendarTask>;

const calendarTaskSchema = new Schema<CalendarTask>(
  {
    _id: {
      type: String,
      required: true,
      match: [UUID_V4, 'task id must be a lower-case UUID v4'],
    },
    userId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    plotId: {
      type: String,
      ref: 'Plot',
      required: true,
      match: [UUID_V4, 'plot id must be a lower-case UUID v4'],
    },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    // The pattern is enforced here as a last line of defence; a bad date is a
    // 422 from `isoDateSchema` long before it reaches this, because a
    // Mongoose validation failure would be a 500.
    dueDate: {
      type: String,
      required: true,
      match: [ISO_DATE_PATTERN, 'dueDate must be a day as YYYY-MM-DD'],
    },
    completedOn: {
      type: String,
      default: null,
      match: [ISO_DATE_PATTERN, 'completedOn must be a day as YYYY-MM-DD'],
    },
    status: { type: String, enum: TASK_STATUSES, required: true, default: 'pending' },
    completedAt: { type: Date, default: null },
    isUserEdited: { type: Boolean, required: true, default: false },
    generationBatchId: {
      type: String,
      default: null,
      match: [UUID_V4, 'generationBatchId must be a lower-case UUID v4'],
    },
    source: { type: String, enum: TASK_SOURCES, required: true, default: 'manual' },
    reminderAt: { type: String, default: null },
    version: { type: Number, default: 1, min: 1 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'calendarTasks' },
);

// Declared here rather than on the paths, so every index for this collection
// is visible in one place. Both are equality fields first, then `dueDate`
// ascending as the sort key, so each query walks its index in order and never
// sorts in memory.
//
// One plot's calendar — the month and week views, which always name a plot.
calendarTaskSchema.index(
  { userId: 1, plotId: 1, deletedAt: 1, dueDate: 1 },
  { name: 'owner_plot_live_due' },
);
// Every plot's, for `/calendar/upcoming`. Not served by the index above:
// `plotId` sits in the middle of it, and a query that does not constrain
// `plotId` can only use `userId` as a prefix — which would leave the date
// range and the sort to be done in memory over every task the farmer owns.
calendarTaskSchema.index({ userId: 1, deletedAt: 1, dueDate: 1 }, { name: 'owner_live_due' });
// `/calendar/today` has no index of its own, and that is a finding rather
// than an omission. `owner_live_due` above is what `explain()` picks for it:
// IXSCAN on (userId, deletedAt, dueDate) bounded by the seven-day horizon,
// then the status test as a residual filter on the FETCH.
//
// A `{ userId, deletedAt, status, dueDate }` index was written, measured and
// removed. The pipeline's `$match` carries an `$or` -- the `today` bucket
// wants every status while `overdue` and `next7` want only `pending` -- and
// with `status` unconstrained on one branch the planner cannot use it as an
// index prefix. It scored the status index into the rejected plans and chose
// `owner_live_due` anyway, both as written and with both branches rewritten to
// name `status`. An index no plan selects is write cost with nothing bought.
//
// What makes that acceptable is the bound: the scan covers one farmer's tasks
// up to the horizon, which is tens to low hundreds of documents, and the
// backward end is unbounded because an overdue task is unbounded by
// definition. `docs/schema.md` §19 records the measurement.
// The generator's idempotency check: "has this batch already run on this
// plot?". Nothing else queries by batch, so the plot leads and the batch id
// follows, which also makes it the index that finds the *previous* batch's
// tasks when a new batch supersedes them.
calendarTaskSchema.index(
  { plotId: 1, generationBatchId: 1 },
  { name: 'plot_generation_batch', sparse: true },
);

export const CalendarTaskModel: Model<CalendarTask> = model<CalendarTask>(
  'CalendarTask',
  calendarTaskSchema,
);
