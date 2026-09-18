import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { CalendarTaskModel, type CalendarTask } from '@models';
import { toObjectId } from '@shared';

import { createApp } from '../../app';
import { seedCropStageTemplates } from '../../seed/cropStageTemplates';
import { seedFarmer, type Actor } from '../../test/actors';
import { body } from '../../test/http';

import { pipeline } from './calendarToday.service';

/**
 * `GET /calendar/today`, end to end, and the explain plan behind it.
 *
 * Three things a stubbed model would get wrong:
 *
 * - **The bucket boundaries.** Overdue is unbounded backwards, today ignores
 *   status, next7 does not. Each of those is a decision, and each is one
 *   off-by-one away from a farmer losing a task off their screen.
 * - **The join is a join.** One round trip for the whole screen, not one per
 *   plot. Asserted by reading the pipeline rather than by timing it.
 * - **The `$match` uses an index.** A collection scan passes every functional
 *   test in this file and falls over on the first farmer with three seasons of
 *   history.
 */

const app = createApp();

const TODAY = '2026-06-10';

const PLOT = {
  crop: 'PADDY',
  areaAcres: 2.5,
  centroid: { type: 'Point', coordinates: [80.401, 8.301] },
};

interface TodayBody {
  date: string;
  overdue: (CalendarTask & { plotName: string })[];
  today: (CalendarTask & { plotName: string })[];
  next7: (CalendarTask & { plotName: string })[];
}

beforeEach(async () => {
  await seedCropStageTemplates();
});

function getToday(token: string, date?: string): request.Test {
  const query = date === undefined ? '' : `?date=${date}`;
  return request(app).get(`/api/v1/calendar/today${query}`).set('Authorization', `Bearer ${token}`);
}

async function createPlot(actor: Actor, name: string): Promise<string> {
  const id = randomUUID();
  const response = await request(app)
    .put(`/api/v1/plots/${id}`)
    .set('Authorization', `Bearer ${actor.token}`)
    .send({ ...PLOT, name });

  expect(response.status).toBe(201);
  return id;
}

/**
 * Writes a task straight to the collection.
 *
 * Through the model rather than through `PUT /calendar/:id` because these
 * tests are arranging a calendar at specific days and statuses, and going
 * through the write path would make every arrangement depend on the write
 * path's own rules as well as on the one under test.
 */
async function addTask(
  actor: Actor,
  plotId: string,
  dueDate: string,
  status: 'pending' | 'done' | 'skipped' = 'pending',
): Promise<string> {
  const id = randomUUID();
  await CalendarTaskModel.create({
    _id: id,
    userId: actor.farmer._id,
    plotId,
    type: 'irrigation',
    title: 'calendar.task.paddy.midSeasonWater.title',
    dueDate,
    status,
    completedOn: status === 'done' ? dueDate : null,
    completedAt: status === 'pending' ? null : new Date(),
    source: 'template',
    isUserEdited: false,
    generationBatchId: null,
    version: 1,
  });
  return id;
}

/**
 * The winning plan's stages, outermost first, as `STAGE(indexName)` strings.
 *
 * An aggregate explain nests the query plan under `stages[0].$cursor`; a find
 * explain puts it at the top level. Both shapes are handled so the helper does
 * not have to change if the pipeline's first stage ever does.
 */
function winningPlanStages(explained: unknown): string[] {
  const root = explained as {
    stages?: { $cursor?: { queryPlanner?: { winningPlan?: PlanStage } } }[];
    queryPlanner?: { winningPlan?: PlanStage };
  };
  const winning =
    root.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ?? root.queryPlanner?.winningPlan;

  const walk = (stage: PlanStage | undefined): string[] => {
    if (!stage) {
      return [];
    }
    const label =
      stage.indexName === undefined ? stage.stage : `${stage.stage}(${stage.indexName})`;
    return [label, ...[stage.inputStage, ...(stage.inputStages ?? [])].flatMap(walk)];
  };
  return walk(winning);
}

interface PlanStage {
  stage: string;
  indexName?: string;
  inputStage?: PlanStage;
  inputStages?: PlanStage[];
}

/* -------------------------------------------------------------------------- */

describe('GET /calendar/today', () => {
  it('splits tasks into overdue, today and next7', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor, 'Upper field');

    await addTask(actor, plotId, '2026-06-08'); // overdue
    await addTask(actor, plotId, '2026-06-10'); // today
    await addTask(actor, plotId, '2026-06-14'); // next7

    const response = await getToday(actor.token, TODAY);

    expect(response.status).toBe(200);
    const buckets = body<TodayBody>(response);
    expect(buckets.date).toBe(TODAY);
    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.today).toHaveLength(1);
    expect(buckets.next7).toHaveLength(1);
  });

  it('joins the plot name onto every task', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor, 'Upper field');
    await addTask(actor, plotId, TODAY);

    const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

    expect(buckets.today[0]?.plotName).toBe('Upper field');
  });

  it('covers every plot the farmer owns, in one response', async () => {
    const actor = await seedFarmer();
    const upper = await createPlot(actor, 'Upper field');
    const lower = await createPlot(actor, 'Lower field');
    await addTask(actor, upper, TODAY);
    await addTask(actor, lower, TODAY);

    const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

    expect(buckets.today).toHaveLength(2);
    expect(buckets.today.map((task) => task.plotName).sort()).toEqual([
      'Lower field',
      'Upper field',
    ]);
  });

  describe('bucket boundaries', () => {
    it('keeps an overdue task however old it is', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2025-01-01');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      // A task due eighteen months ago and never done is still the most
      // urgent thing this farmer owns. A window that dropped it would hide a
      // missed spray behind a clean screen.
      expect(buckets.overdue).toHaveLength(1);
    });

    it('leaves a completed past task out of overdue', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-06-08', 'done');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.overdue).toHaveLength(0);
    });

    it('leaves a skipped past task out of overdue', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-06-08', 'skipped');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      // A skipped task is a decision the farmer already made. Putting it back
      // on the urgent list would be the app arguing with them.
      expect(buckets.overdue).toHaveLength(0);
    });

    it('keeps a completed task in today, so the day does not empty as it is worked', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, TODAY, 'done');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.today).toHaveLength(1);
      expect(buckets.today[0]?.status).toBe('done');
    });

    it('includes the seventh day and excludes the eighth', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-06-17'); // today + 7
      await addTask(actor, plotId, '2026-06-18'); // today + 8

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.next7).toHaveLength(1);
      expect(buckets.next7[0]?.dueDate).toBe('2026-06-17');
    });

    it('leaves a completed future task out of next7', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-06-12', 'done');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.next7).toHaveLength(0);
    });

    it('crosses a month end correctly', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-07-02');

      const buckets = body<TodayBody>(await getToday(actor.token, '2026-06-30'));

      expect(buckets.next7).toHaveLength(1);
    });

    it('orders each bucket by day', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, '2026-06-16');
      await addTask(actor, plotId, '2026-06-12');
      await addTask(actor, plotId, '2026-06-14');

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.next7.map((task) => task.dueDate)).toEqual([
        '2026-06-12',
        '2026-06-14',
        '2026-06-16',
      ]);
    });
  });

  describe('scope', () => {
    it('shows nothing belonging to another farmer', async () => {
      const actor = await seedFarmer();
      const stranger = await seedFarmer();
      const plotId = await createPlot(stranger, 'Their field');
      await addTask(stranger, plotId, TODAY);

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.today).toHaveLength(0);
    });

    it('drops tasks on a deleted plot', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, TODAY);
      await request(app)
        .delete(`/api/v1/plots/${plotId}`)
        .set('Authorization', `Bearer ${actor.token}`);

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      // The plot is gone from `/plots`; a task on it would be work on a field
      // the farmer has said they no longer have.
      expect(buckets.today).toHaveLength(0);
    });

    it('drops a soft-deleted task', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      const taskId = await addTask(actor, plotId, TODAY);
      await CalendarTaskModel.updateOne(
        { _id: taskId },
        { $set: { deletedAt: new Date() } },
      ).exec();

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets.today).toHaveLength(0);
    });

    it('answers with three empty buckets when there is nothing to do', async () => {
      const actor = await seedFarmer();

      const buckets = body<TodayBody>(await getToday(actor.token, TODAY));

      expect(buckets).toEqual({ date: TODAY, overdue: [], today: [], next7: [] });
    });

    it('requires a token', async () => {
      const response = await request(app).get('/api/v1/calendar/today');

      expect(response.status).toBe(401);
    });
  });

  describe('the date parameter', () => {
    it('defaults to today in Colombo when none is given', async () => {
      const actor = await seedFarmer();

      const buckets = body<TodayBody>(await getToday(actor.token));

      // Not asserted against a fixed string — the point is that the server
      // decides and says which day it decided on, so the client never has to.
      expect(buckets.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects a day that does not exist', async () => {
      const actor = await seedFarmer();

      expect((await getToday(actor.token, '2026-02-30')).status).toBe(422);
    });

    it('rejects a timestamp', async () => {
      const actor = await seedFarmer();

      expect((await getToday(actor.token, '2026-06-10T00:00:00.000Z')).status).toBe(422);
    });
  });

  describe('the query plan', () => {
    it('joins in the pipeline rather than reading plots per task', () => {
      const stages = pipeline(toObjectId('6720f1a2c3d4e5f60718293a'), TODAY, '2026-06-17');

      // The structural guarantee behind "no N+1": there is exactly one join,
      // it is a `$lookup`, and nothing in this module reads `plots` again.
      const lookups = stages.filter((stage) => '$lookup' in stage);
      expect(lookups).toHaveLength(1);
    });

    it('serves the $match from owner_live_due, and never scans the collection', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor, 'Upper field');
      await addTask(actor, plotId, TODAY);

      const stages = winningPlanStages(
        await CalendarTaskModel.aggregate(
          pipeline(toObjectId(actor.farmer._id.toString()), TODAY, '2026-06-17'),
        ).explain(),
      );

      // The *winning* plan, not the whole explain document. Searching the raw
      // JSON for an index name passes on a rejected plan too, which is exactly
      // how a query quietly stops using the index it was built for -- this
      // assertion was written that way first and did.
      expect(stages).toContain('IXSCAN(owner_live_due)');
      expect(stages.some((stage) => stage.startsWith('COLLSCAN'))).toBe(false);
    });
  });
});
