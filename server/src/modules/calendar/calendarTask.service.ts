import { randomUUID } from 'node:crypto';

import type { FilterQuery, Types } from 'mongoose';

import { CalendarTaskModel, PlotModel, type CalendarTask, type Plot } from '@models';
import {
  AppError,
  ErrorCode,
  HttpStatus,
  addDays,
  toIsoDate,
  toObjectId,
  todayInSriLanka,
  type CalendarListQuery,
  type CalendarTaskCompleteInput,
  type CalendarTaskInput,
  type CalendarTaskUpdateInput,
  type CalendarUpcomingQuery,
  type IsoDate,
  type TaskStatus,
} from '@shared';

import { templateFor } from './cropCalendar.templates';

/**
 * Crop calendar reads and writes.
 *
 * The two rules from `plot.service` hold here unchanged, and there is no path
 * through this module that breaks either:
 *
 * 1. **The owner is a parameter, never a payload field.** Callers pass
 *    `req.user.id`; the input schemas have no `userId` at all.
 * 2. **Ownership is part of the query, not a check after it.** Every filter
 *    carries `userId`, so another farmer's task does not match and a probe
 *    cannot tell "not yours" from "does not exist".
 *
 * There is a third rule this collection adds, because a task points at a plot:
 *
 * 3. **A write naming a plot proves the plot is the caller's** —
 *    {@link assertOwnsPlot} — before anything is stored against it. Without
 *    it, a farmer could hang tasks off a neighbour's plot id and learn which
 *    ids exist from whether the write succeeded.
 *
 * Every date here is a day, `YYYY-MM-DD`, compared as a string. See
 * `@agrisense/shared`'s `domain/dates.ts` for why nothing in this file
 * constructs a `Date` for a due date.
 */

export interface SaveResult {
  task: CalendarTask;
  /** `true` when this call created the task, for the 201/200 decision. */
  created: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The caller's tasks in a date window, earliest first.
 *
 * `from` and `to` are inclusive at both ends — `$gte`/`$lte` — which is what
 * a farmer means by "the 1st to the 7th" and what a month grid asks for. That
 * works as a plain string comparison because `YYYY-MM-DD` sorts lexically in
 * the order it sorts chronologically.
 *
 * Completed tasks stay in the list. A calendar that hid them would lose the
 * record of what was done and when, which is half of what the screen is for.
 */
export async function list(userId: string, query: CalendarListQuery): Promise<CalendarTask[]> {
  const filter = liveOwnedBy(toObjectId(userId));

  if (query.plotId !== undefined) {
    filter.plotId = query.plotId;
  }
  const range = dateRange(query.from, query.to);
  if (range) {
    filter.dueDate = range;
  }

  return CalendarTaskModel.find(filter)
    .sort({ dueDate: 1, _id: 1 })
    .limit(query.limit)
    .lean<CalendarTask[]>()
    .exec();
}

/**
 * What is still to do, across every plot, earliest first.
 *
 * Two decisions the endpoint's name does not carry:
 *
 * - **Completed tasks are excluded.** This is the "what do I do next" list,
 *   not the calendar; a ticked task answers a different question.
 * - **Overdue tasks are included**, not only the next `days`. A task due
 *   yesterday and not done is the most urgent thing a farmer owns, and a list
 *   that silently dropped it would hide a missed spray behind a clean screen.
 *   The window bounds the future end only.
 */
export async function upcoming(
  userId: string,
  query: CalendarUpcomingQuery,
  today: IsoDate = todayInSriLanka(),
): Promise<CalendarTask[]> {
  const filter = liveOwnedBy(toObjectId(userId));
  filter.completedOn = null;
  filter.dueDate = { $lte: addDays(today, query.days) };

  return CalendarTaskModel.find(filter)
    .sort({ dueDate: 1, _id: 1 })
    .limit(query.limit)
    .lean<CalendarTask[]>()
    .exec();
}

export async function getById(userId: string, taskId: string): Promise<CalendarTask> {
  const task = await CalendarTaskModel.findOne(liveOwnedBy(toObjectId(userId), taskId))
    .lean<CalendarTask>()
    .exec();

  if (!task) {
    throw taskNotFound();
  }
  return task;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates the task under the client's own UUID, or replaces it if it is
 * already there — the same contract as `PUT /plots/:id`, and for the same
 * reason: this is what an offline queue replays into, so running it twice has
 * to leave exactly what running it once did.
 *
 * Two fields the body cannot reach:
 *
 * - `source` is `$setOnInsert`. A client that could claim `template` could
 *   hide a task from regeneration; a client that could claim `manual` could
 *   hand the generator a task it will not clean up. The server decides, once,
 *   at insert, and a later replace leaves it alone.
 * - `completedOn` is not in the replacement at all. Whether the work is done
 *   is lifecycle state, like `version` and `deletedAt`, which `PUT` does not
 *   clear either — otherwise a phone replaying a two-day-old title edit would
 *   silently un-tick a task the farmer has since finished.
 */
export async function save(
  userId: string,
  taskId: string,
  input: CalendarTaskInput,
): Promise<SaveResult> {
  const owner = toObjectId(userId);
  await assertOwnsPlot(owner, input.plotId);

  try {
    const result = await CalendarTaskModel.findOneAndUpdate(
      // As in `plot.service`: an upsert that matches nothing builds the new
      // document out of the filter's equality clauses, so `_id`, `userId` and
      // `deletedAt` all arrive from here and cannot come from a body.
      liveOwnedBy(owner, taskId),
      {
        $set: {
          plotId: input.plotId,
          type: input.type,
          title: input.title,
          dueDate: input.dueDate,
          // Nullable rather than absent, so a client can tell "cleared" from
          // "never set" without inspecting which keys came back.
          notes: input.notes ?? null,
          reminderAt: input.reminderAt ?? null,
          // A farmer wrote this, so regeneration may never clear it. True on
          // a replace as well as an insert: the point of the flag is "a human
          // has had a hand in this task", and a replace is exactly that.
          isUserEdited: true,
        },
        $setOnInsert: {
          source: 'manual',
          completedOn: null,
          status: 'pending',
          completedAt: null,
          generationBatchId: null,
        },
        $inc: { version: 1 },
      },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        // Off for the reason spelled out in `plot.service.save`: `version` has
        // a schema default *and* an `$inc`, and Mongoose would add a
        // `$setOnInsert` for it that MongoDB rejects as a path conflict. Every
        // other defaulted path is supplied above or by the filter.
        setDefaultsOnInsert: false,
        includeResultMetadata: true,
        lean: true,
      },
    ).exec();

    return {
      task: expectWritten(result.value),
      created: result.lastErrorObject?.upserted !== undefined,
    };
  } catch (error) {
    // The filter matched nothing and the insert hit a taken `_id`: either
    // another farmer owns that UUID or this farmer deleted it. Both are 404,
    // as in `plot.service` — the first must not confirm the id exists, and the
    // second is what a tombstone is for.
    if (isDuplicateKey(error)) {
      throw taskNotFound();
    }
    throw error;
  }
}

/**
 * Merges a partial body into an existing task. Absent fields are left alone.
 *
 * Never upserts: a `PATCH` names a resource that is supposed to exist, and
 * building one from a fragment would leave required fields unset.
 *
 * Unlike {@link save} this *may* set `completedOn`, including to `null`. A
 * `PATCH` names the field it means, so `{"completedOn": null}` is a farmer
 * undoing a tick they did not intend — and there is no other way to say it.
 */
export async function update(
  userId: string,
  taskId: string,
  patch: CalendarTaskUpdateInput,
): Promise<CalendarTask> {
  const owner = toObjectId(userId);

  // Only when the patch moves the task to another plot. A patch that does not
  // mention `plotId` cannot change whose plot it is on.
  if (patch.plotId !== undefined) {
    await assertOwnsPlot(owner, patch.plotId);
  }

  const task = await CalendarTaskModel.findOneAndUpdate(
    liveOwnedBy(owner, taskId),
    // The patch goes in as-is: Zod has already stripped everything not in the
    // schema, so no unknown path and no `$` operator survives to reach here.
    // `isUserEdited` and the `status` pair are added rather than accepted from
    // the body -- a client cannot claim either, and `completedOn` arriving
    // here without `status` following it would leave the two disagreeing about
    // whether the work is done.
    {
      $set: { ...patch, isUserEdited: true, ...statusFieldsFor(patch.completedOn) },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true },
  )
    .lean<CalendarTask>()
    .exec();

  if (!task) {
    throw taskNotFound();
  }
  return task;
}

/**
 * Ticks a task off.
 *
 * The day comes from the client when it sends one, because the phone knows
 * what day it is where the farmer is standing; the fallback is today in
 * Colombo rather than today in UTC, which between 18:30 and midnight UTC is
 * already a different day.
 *
 * Idempotent on purpose: completing an already-completed task overwrites the
 * day rather than failing, so an offline queue replaying the tap does not
 * surface an error about work that is demonstrably done.
 */
export async function complete(
  userId: string,
  taskId: string,
  input: CalendarTaskCompleteInput,
): Promise<CalendarTask> {
  const task = await CalendarTaskModel.findOneAndUpdate(
    liveOwnedBy(toObjectId(userId), taskId),
    {
      $set: {
        completedOn: input.completedOn ?? todayInSriLanka(),
        status: 'done',
        completedAt: new Date(),
        isUserEdited: true,
      },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true },
  )
    .lean<CalendarTask>()
    .exec();

  if (!task) {
    throw taskNotFound();
  }
  return task;
}

/**
 * Soft delete. The row stays, `deletedAt` is stamped and the UUID stays
 * reserved, so a replayed create cannot resurrect a task the farmer removed.
 */
export async function softDelete(userId: string, taskId: string): Promise<void> {
  const result = await CalendarTaskModel.updateOne(liveOwnedBy(toObjectId(userId), taskId), {
    $set: { deletedAt: new Date() },
    $inc: { version: 1 },
  }).exec();

  // An already-deleted task does not match, so a repeated DELETE is a 404
  // rather than a second tombstone overwriting the real deletion time.
  if (result.matchedCount === 0) {
    throw taskNotFound();
  }
}

/* -------------------------------------------------------------------------- */
/* Template generation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Builds the plot's calendar from the template for its crop, replacing the
 * template tasks it already has.
 *
 * What it replaces is the whole of the rule, and it is deliberately narrow:
 *
 * - **Manual tasks are never touched.** They are the farmer's own writing.
 * - **Completed tasks are never touched, template or not.** A tick is a record
 *   of something that actually happened in a field. Regenerating over it would
 *   delete history to tidy up a plan.
 * - Everything else with `source: 'template'` on this plot is tombstoned and
 *   rebuilt from the current `plantedAt`.
 *
 * Replaced tasks are soft-deleted rather than removed, like every other delete
 * in this collection: a phone holding yesterday's calendar has to be able to
 * learn that those tasks are gone, and a row that vanished tells it nothing.
 *
 * A plot with no `plantedAt` generates nothing and clears what it had — which
 * is the correct reading of "nothing is in the ground here".
 */
export async function generateTasksForPlot(plot: Plot): Promise<CalendarTask[]> {
  await CalendarTaskModel.updateMany(
    {
      userId: plot.userId,
      plotId: plot._id,
      deletedAt: null,
      source: 'template',
      completedOn: null,
      // Added Day 12, alongside the field. `completedOn: null` alone spares
      // work already finished; it does not spare a task whose date or title a
      // farmer has corrected but not yet done. Both are the farmer's, and a
      // rebuild of the *plan* must not discard either.
      isUserEdited: false,
    },
    { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
  ).exec();

  const tasks = buildTemplateTasks(plot);
  if (tasks.length === 0) {
    return [];
  }

  // Not in a transaction: the deployment is a single mongod, and this repo
  // takes no dependency on a replica set. The exposure is a delete that lands
  // without its rebuild — a farmer would see an empty calendar and get it back
  // by re-saving the plot, which is recoverable in a way that losing a manual
  // task would not be. That is why the delete above is scoped so tightly.
  return CalendarTaskModel.insertMany(tasks, { lean: true });
}

/**
 * Regenerates a plot's calendar when, and only when, the planting day moved.
 *
 * Called by `plot.service` after a write. The guard is what keeps `PUT` idempotent
 * in the way that matters to a client: replaying the same plot body must not
 * churn the calendar, because every rebuild mints new task ids and every phone
 * holding the old ones would have to reconcile a calendar that did not
 * actually change.
 */
export async function syncTemplateTasks(plot: Plot, previousPlantedAt: Date | null): Promise<void> {
  const before = previousPlantedAt === null ? null : toIsoDate(previousPlantedAt);
  const after = plot.plantedAt == null ? null : toIsoDate(plot.plantedAt);

  if (before === after) {
    return;
  }
  await generateTasksForPlot(plot);
}

/**
 * Tombstones every live task on a plot, for when the plot itself is deleted.
 *
 * Manual tasks go too, which is the one place they are not sacred: they are
 * work on a field the farmer has just said they no longer have, and leaving
 * them would put a plot that is gone from `/plots` back on the home screen's
 * "what is due" list with no way to clear it.
 */
export async function discardTasksForPlot(userId: Types.ObjectId, plotId: string): Promise<void> {
  await CalendarTaskModel.updateMany(
    { userId, plotId, deletedAt: null },
    { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
  ).exec();
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** The tasks a plot's crop template implies, from its planting day. */
function buildTemplateTasks(plot: Plot): CalendarTask[] {
  if (plot.plantedAt == null) {
    return [];
  }

  // `plantedAt` is an instant holding a day: written as UTC midnight of the
  // day the farmer picked, so read back in UTC and nowhere else.
  const planted = toIsoDate(plot.plantedAt);
  const now = new Date();

  return templateFor(plot.crop).activities.map((activity) => ({
    // Server-minted, because no client asked for these. Same id space as a
    // client's own tasks: a phone cannot be asked to care which end made one.
    _id: randomUUID(),
    userId: plot.userId,
    plotId: plot._id,
    type: activity.type,
    // The i18n keys, not sentences. `source: 'template'` is how a client knows
    // to translate these rather than print them.
    title: activity.titleKey,
    notes: activity.descriptionKey,
    dueDate: addDays(planted, activity.dayOffset),
    completedOn: null,
    status: 'pending' as const,
    completedAt: null,
    // Nothing a farmer has touched, by definition: the generator has only
    // just made it. This is what the *next* regeneration reads to decide
    // whether it may clear this task away again.
    isUserEdited: false,
    // Null rather than a fresh UUID. These come from `plantedAt` moving, not
    // from a client asking for a run, so there is no batch to belong to --
    // `POST /plots/:plotId/calendar/generate` is the path that has one.
    generationBatchId: null,
    source: 'template' as const,
    reminderAt: null,
    version: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * The filter every read and write in this module starts from: owned by this
 * caller, not deleted, and -- when an id is given -- that exact task.
 */
function liveOwnedBy(userId: Types.ObjectId, taskId?: string): FilterQuery<CalendarTask> {
  return taskId === undefined
    ? { userId, deletedAt: null }
    : { _id: taskId, userId, deletedAt: null };
}

/**
 * Refuses a write against a plot the caller does not own, before anything is
 * stored against it.
 *
 * `PLOT_NOT_FOUND`, and the same 404 a direct read of that plot would give:
 * the answer must not depend on whether the id happens to belong to somebody
 * else, or this becomes a way to enumerate plots.
 */
async function assertOwnsPlot(userId: Types.ObjectId, plotId: string): Promise<void> {
  const exists = await PlotModel.exists({ _id: plotId, userId, deletedAt: null }).exec();

  if (!exists) {
    throw new AppError('No plot with that id exists for this account', HttpStatus.NOT_FOUND, {
      code: ErrorCode.PLOT_NOT_FOUND,
    });
  }
}

/**
 * The `status`/`completedAt` pair implied by a `PATCH` that names
 * `completedOn`, or nothing at all when it does not.
 *
 * `undefined` means the patch did not mention completion, and the stored
 * lifecycle is left exactly as it was. `null` means a farmer is undoing a tick
 * -- the task goes back to `pending` and the instant is cleared, because there
 * is no longer a moment at which it was finished.
 *
 * A `skipped` task is not reachable from here on purpose. Skipping is a
 * decision about the future, not a day on which something happened, and it has
 * its own endpoint -- `PATCH /calendar/tasks/:id`.
 */
function statusFieldsFor(
  completedOn: IsoDate | null | undefined,
): { status: TaskStatus; completedAt: Date | null } | Record<string, never> {
  if (completedOn === undefined) {
    return {};
  }
  return completedOn === null
    ? { status: 'pending', completedAt: null }
    : { status: 'done', completedAt: new Date() };
}

/** Both ends are optional; either one alone still bounds the query. */
function dateRange(from?: IsoDate, to?: IsoDate): { $gte?: IsoDate; $lte?: IsoDate } | undefined {
  if (from === undefined && to === undefined) {
    return undefined;
  }
  return {
    ...(from === undefined ? {} : { $gte: from }),
    ...(to === undefined ? {} : { $lte: to }),
  };
}

function taskNotFound(): AppError {
  return new AppError(
    'No calendar task with that id exists for this account',
    HttpStatus.NOT_FOUND,
    {
      code: ErrorCode.CALENDAR_TASK_NOT_FOUND,
    },
  );
}

/** MongoDB's unique-index violation, narrowed without an `any` cast. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * An upsert that reports neither a document nor an error has no benign
 * reading, so it fails loudly rather than returning a half-saved task.
 */
function expectWritten(value: CalendarTask | null): CalendarTask {
  if (!value) {
    throw AppError.internal('Calendar task upsert returned no document');
  }
  return value;
}
