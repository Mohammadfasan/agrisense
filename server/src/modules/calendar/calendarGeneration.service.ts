import { randomUUID } from 'node:crypto';

import type { ClientSession, Types } from 'mongoose';

import {
  CalendarTaskModel,
  CropStageTemplateModel,
  PlotModel,
  type CalendarTask,
  type CropStageTemplate,
  type Plot,
} from '@models';
import {
  AppError,
  ErrorCode,
  HttpStatus,
  toObjectId,
  withTransaction,
  type CalendarGenerateInput,
  type IsoDate,
} from '@shared';

import { addDays } from '../../utils/dateString';

/**
 * Calendar generation — building a plot's season from the crop stage
 * templates.
 *
 * The three rules `calendarTask.service` states hold here unchanged: the owner
 * is a parameter rather than a payload field, ownership is part of the query
 * rather than a check after it, and a plot the caller does not own answers 404
 * rather than 403. There is nothing in this module that reads a `userId` from
 * a body, and nothing that loads a plot and then compares owners.
 *
 * Two things are specific to generation.
 *
 * **It is idempotent on `generationBatchId`.** The batch id comes from the
 * client, which mints it before the request leaves the phone. A retry after a
 * lost response carries the same id, finds the tasks that id already wrote and
 * returns them — so the farmer gets one calendar, not two overlaid. A *new*
 * batch id is a different statement: the farmer is asking for the calendar to
 * be rebuilt, usually because they corrected the sowing date, and only then is
 * the previous batch cleared away.
 *
 * **What a rebuild may clear is deliberately narrow.** Only tasks that are
 * generated, still `pending`, and untouched by the farmer. A manual task is
 * the farmer's own writing; a `done` or `skipped` one is a record of a
 * decision that was actually made in a field; an edited one is a correction
 * the farmer has already made to the plan. None of the three is the
 * generator's to take back, and tidying up a plan must never delete history.
 */

export interface GenerateResult {
  tasks: CalendarTask[];
  /**
   * `false` when this batch id had already been generated and the stored tasks
   * were returned untouched. Drives the 201/200 decision in the controller.
   */
  created: boolean;
  /** How many superseded tasks the rebuild tombstoned. Zero on a first run. */
  supersededCount: number;
}

/**
 * Generates the calendar for one plot from its crop's stage templates.
 *
 * The sowing date is persisted on the plot as part of the same unit of work:
 * the calendar and the day it was generated from are one fact, and a plot
 * whose stored sowing date disagrees with the dates on its tasks cannot be
 * reasoned about afterwards.
 */
export async function generateForPlot(
  userId: string,
  plotId: string,
  input: CalendarGenerateInput,
): Promise<GenerateResult> {
  const owner = toObjectId(userId);

  // Ownership is inside the query, not a comparison after it. A plot that
  // belongs to another farmer, or one this farmer deleted, matches nothing and
  // is a 404 — never a 403, which would confirm the id is in use.
  const plot = await PlotModel.findOne({ _id: plotId, userId: owner, deletedAt: null })
    .lean<Plot>()
    .exec();

  if (!plot) {
    throw plotNotFound();
  }

  // Before the transaction, and deliberately outside it: a replayed request is
  // the common case, not the exceptional one, and answering it should not cost
  // a session. The check is repeated inside the transaction, where it is the
  // one that actually decides.
  const existing = await tasksInBatch(owner, plotId, input.generationBatchId);
  if (existing.length > 0) {
    return { tasks: existing, created: false, supersededCount: 0 };
  }

  const stages = await stagesForCrop(plot.crop);
  const tasks = buildTasks(plot, stages, input);

  return withTransaction(async (session) => {
    // Re-read inside the transaction. Two phones replaying the same batch can
    // both pass the check above; only one of them can pass this one, and the
    // other returns what the first wrote.
    const alreadyWritten = await tasksInBatch(owner, plotId, input.generationBatchId, session);
    if (alreadyWritten.length > 0) {
      return { tasks: alreadyWritten, created: false, supersededCount: 0 };
    }

    const superseded = await supersedePreviousBatches(
      owner,
      plotId,
      input.generationBatchId,
      session,
    );

    if (tasks.length > 0) {
      // `session ?? null` rather than passing `undefined` through: with
      // `exactOptionalPropertyTypes` the driver's option is `ClientSession |
      // null`, and `null` is its own spelling of "no session".
      await CalendarTaskModel.insertMany(tasks, { session: session ?? null });
    }

    // In the same unit of work as the tasks. A sowing date stored without the
    // calendar it produced, or the other way round, is a plot nobody can
    // explain afterwards. `plantedAt` is written alongside it because Day 10's
    // field is what `syncTemplateTasks` still reads, and the two saying
    // different things would be worse than either one being absent.
    await PlotModel.updateOne(
      { _id: plotId, userId: owner, deletedAt: null },
      {
        $set: {
          sowingDate: input.sowingDate,
          plantedAt: new Date(`${input.sowingDate}T00:00:00.000Z`),
        },
        $inc: { version: 1 },
      },
      sessionOption(session),
    ).exec();

    return { tasks, created: true, supersededCount: superseded };
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The live tasks a given batch already wrote for this plot.
 *
 * Ordered exactly as a freshly generated set would be, so a client cannot tell
 * a replay from a first run by the order things came back in.
 */
async function tasksInBatch(
  userId: Types.ObjectId,
  plotId: string,
  generationBatchId: string,
  session?: ClientSession,
): Promise<CalendarTask[]> {
  return CalendarTaskModel.find({ userId, plotId, generationBatchId, deletedAt: null })
    .sort({ dueDate: 1, _id: 1 })
    .session(session ?? null)
    .lean<CalendarTask[]>()
    .exec();
}

/**
 * Tombstones the tasks a previous run left behind, and nothing else.
 *
 * Every clause in this filter is load-bearing:
 *
 * - `source: 'template'` — a manual task is the farmer's own writing and is
 *   never the generator's to remove.
 * - `status: 'pending'` — a `done` task records work that happened in a field
 *   and a `skipped` one records a decision the farmer made. Both are history.
 * - `isUserEdited: false` — a task whose date or title the farmer corrected is
 *   theirs now, even though the generator made it and even though it is not
 *   done yet.
 * - `generationBatchId: { $ne: <this batch> }` — the run about to happen must
 *   not delete its own output if it is ever retried mid-flight.
 *
 * A soft delete rather than a removal, like every other delete in this
 * collection: a phone holding yesterday's calendar has to be able to learn
 * that those tasks are gone, and a row that simply vanished tells it nothing.
 */
async function supersedePreviousBatches(
  userId: Types.ObjectId,
  plotId: string,
  generationBatchId: string,
  session?: ClientSession,
): Promise<number> {
  const result = await CalendarTaskModel.updateMany(
    {
      userId,
      plotId,
      deletedAt: null,
      source: 'template',
      status: 'pending',
      isUserEdited: false,
      generationBatchId: { $ne: generationBatchId },
    },
    { $set: { deletedAt: new Date() }, $inc: { version: 1 } },
    sessionOption(session),
  ).exec();

  return result.modifiedCount;
}

/**
 * `{ session }`, or `{}` when there is none.
 *
 * Spread rather than passed as `{ session: undefined }` because
 * `exactOptionalPropertyTypes` is on: for these options an absent key and a
 * key holding `undefined` are different types, and only the first means "no
 * session".
 */
function sessionOption(session: ClientSession | undefined): { session?: ClientSession } {
  return session ? { session } : {};
}

/** Every active stage for a crop, in season order. */
async function stagesForCrop(crop: Plot['crop']): Promise<CropStageTemplate[]> {
  const stages = await CropStageTemplateModel.find({ cropId: crop, isActive: true })
    .sort({ startOffsetDays: 1 })
    .lean<CropStageTemplate[]>()
    .exec();

  // An unseeded database generates an empty calendar, which looks exactly like
  // a crop with nothing to do in it. Better to say so: the fix is to run
  // `npm run seed:templates`, and a farmer should not be the one to discover
  // that it was not run.
  if (stages.length === 0) {
    throw new AppError(
      'No crop stage templates are available for this crop',
      HttpStatus.SERVICE_UNAVAILABLE,
      {
        code: ErrorCode.SERVICE_UNAVAILABLE,
        details: { crop, hint: 'run the seed:templates script' },
      },
    );
  }
  return stages;
}

/**
 * The tasks a plot's stages imply, from the sowing day.
 *
 * `offsetDays` is measured from the sowing date rather than from the start of
 * the stage — see `cropStageTemplate.model` — so this is one `addDays` per
 * task with no stage arithmetic in it.
 *
 * Sorted by day before it is returned. The stages arrive in order and each
 * one's tasks are written in order, but neither is guaranteed by the schema,
 * and the order tasks come back in is what a client renders.
 */
function buildTasks(
  plot: Plot,
  stages: CropStageTemplate[],
  input: CalendarGenerateInput,
): CalendarTask[] {
  const now = new Date();

  return stages
    .flatMap((stage) =>
      stage.tasks.map((item): CalendarTask => {
        const dueDate: IsoDate = addDays(input.sowingDate, item.offsetDays);

        return {
          // Server-minted, because no client asked for these individually. The
          // same id space as a client's own tasks: a phone cannot be asked to
          // care which end made one.
          _id: randomUUID(),
          userId: plot.userId,
          plotId: plot._id,
          type: item.taskType,
          // The i18n key, not a sentence. `source: 'template'` is how a client
          // knows to translate this rather than print it.
          title: item.titleKey,
          notes: null,
          dueDate,
          completedOn: null,
          status: 'pending',
          completedAt: null,
          // Nothing a farmer has touched, by definition. This is what the next
          // regeneration reads to decide whether it may clear the task away.
          isUserEdited: false,
          generationBatchId: input.generationBatchId,
          source: 'template',
          reminderAt: null,
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
      }),
    )
    .sort((a, b) =>
      a.dueDate === b.dueDate ? a._id.localeCompare(b._id) : a.dueDate < b.dueDate ? -1 : 1,
    );
}

/**
 * The same 404 a direct read of that plot would give. The answer must not
 * depend on whether the id happens to belong to somebody else, or this becomes
 * a way to enumerate plots.
 */
function plotNotFound(): AppError {
  return new AppError('No plot with that id exists for this account', HttpStatus.NOT_FOUND, {
    code: ErrorCode.PLOT_NOT_FOUND,
  });
}
