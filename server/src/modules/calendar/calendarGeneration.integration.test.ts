import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { CalendarTaskModel, PlotModel, type CalendarTask, type Plot } from '@models';

import { createApp } from '../../app';
import { seedCropStageTemplates } from '../../seed/cropStageTemplates';
import { body } from '../../test/http';

import { seedFarmer, type Actor } from '../../test/actors';

/**
 * `POST /plots/:plotId/calendar/generate`, end to end against a real MongoDB.
 *
 * The three things worth testing are the three a unit test with a stubbed
 * model would agree with and get wrong:
 *
 * - **Idempotency is on the batch id, not on the request.** Replaying the same
 *   batch has to return the same rows, and a *new* batch has to rebuild.
 * - **The rebuild is surgical.** Manual, done, skipped and edited tasks all
 *   survive it. Every one of those is a farmer's own decision, and tidying a
 *   plan must not delete history.
 * - **Ownership is in the query.** Another farmer's plot id behaves exactly as
 *   though it did not exist — 404, never 403.
 */

const app = createApp();

interface GenerateBody {
  tasks: CalendarTask[];
  generationBatchId: string;
  sowingDate: string;
  supersededCount: number;
}

interface ErrorBody {
  error: { code: string; message: string };
}

const PLOT = {
  name: 'Upper field',
  crop: 'PADDY',
  areaAcres: 2.5,
  centroid: { type: 'Point', coordinates: [80.401, 8.301] },
};

const SOWN = '2026-05-01';

beforeEach(async () => {
  // The generator reads `cropStageTemplates`, which the global setup empties
  // between tests. Reference data, so seeding it is part of arranging the
  // world rather than part of what is under test.
  await seedCropStageTemplates();
});

function generate(token: string, plotId: string, payload: Record<string, unknown>): request.Test {
  return request(app)
    .post(`/api/v1/plots/${plotId}/calendar/generate`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
}

/** A plot with nothing in the ground; the generate call is what sows it. */
async function createPlot(actor: Actor): Promise<string> {
  const id = randomUUID();
  const response = await request(app)
    .put(`/api/v1/plots/${id}`)
    .set('Authorization', `Bearer ${actor.token}`)
    .send(PLOT);

  expect(response.status).toBe(201);
  return id;
}

async function liveTasks(plotId: string): Promise<CalendarTask[]> {
  return CalendarTaskModel.find({ plotId, deletedAt: null })
    .sort({ dueDate: 1, _id: 1 })
    .lean<CalendarTask[]>()
    .exec();
}

/* -------------------------------------------------------------------------- */

describe('POST /plots/:plotId/calendar/generate', () => {
  it('builds the season from the crop stage templates', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor);
    const batch = randomUUID();

    const response = await generate(actor.token, plotId, {
      sowingDate: SOWN,
      generationBatchId: batch,
    });

    expect(response.status).toBe(201);
    const payload = body<GenerateBody>(response);
    expect(payload.tasks.length).toBeGreaterThan(0);
    expect(payload.supersededCount).toBe(0);

    for (const task of payload.tasks) {
      expect(task.source).toBe('template');
      expect(task.status).toBe('pending');
      expect(task.isUserEdited).toBe(false);
      expect(task.generationBatchId).toBe(batch);
      expect(task.version).toBe(1);
      expect(task._id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('computes due dates from the sowing date, in days', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor);

    const response = await generate(actor.token, plotId, {
      sowingDate: SOWN,
      generationBatchId: randomUUID(),
    });

    const { tasks } = body<GenerateBody>(response);
    // Sowing is day 0 and paddy harvest is day 115. Read as days rather than
    // as instants: at UTC+05:30 the instant version of this is off by one.
    expect(tasks[0]?.dueDate).toBe(SOWN);
    expect(tasks.at(-1)?.dueDate).toBe('2026-08-24');
    expect(tasks.every((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))).toBe(true);
  });

  it('returns tasks in due-date order', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor);

    const response = await generate(actor.token, plotId, {
      sowingDate: SOWN,
      generationBatchId: randomUUID(),
    });

    const dates = body<GenerateBody>(response).tasks.map((task) => task.dueDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it('persists the sowing date on the plot', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor);

    await generate(actor.token, plotId, {
      sowingDate: SOWN,
      generationBatchId: randomUUID(),
    });

    const plot = await PlotModel.findById(plotId).lean<Plot>().exec();
    expect(plot?.sowingDate).toBe(SOWN);
    // Day 10's field is written alongside it; the two disagreeing would be
    // worse than either being absent.
    expect(plot?.plantedAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  describe('idempotency', () => {
    it('returns the same tasks, with 200, when the same batch is replayed', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const batch = randomUUID();

      const first = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: batch,
      });
      const second = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: batch,
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);

      const firstIds = body<GenerateBody>(first).tasks.map((task) => task._id);
      const secondIds = body<GenerateBody>(second).tasks.map((task) => task._id);
      // The same rows, not an equivalent set under new ids — a phone holding
      // the first response must not have to reconcile a calendar that did not
      // actually change.
      expect(secondIds).toEqual(firstIds);
      expect((await liveTasks(plotId)).length).toBe(firstIds.length);
    });

    it('does not duplicate tasks across three replays', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const batch = randomUUID();
      const payload = { sowingDate: SOWN, generationBatchId: batch };

      await generate(actor.token, plotId, payload);
      await generate(actor.token, plotId, payload);
      const third = await generate(actor.token, plotId, payload);

      expect(await liveTasks(plotId)).toHaveLength(body<GenerateBody>(third).tasks.length);
    });

    it('rebuilds under a new batch id and tombstones the old one', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const firstBatch = randomUUID();
      const secondBatch = randomUUID();

      const first = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: firstBatch,
      });
      const second = await generate(actor.token, plotId, {
        sowingDate: '2026-05-08',
        generationBatchId: secondBatch,
      });

      expect(second.status).toBe(201);
      expect(body<GenerateBody>(second).supersededCount).toBe(
        body<GenerateBody>(first).tasks.length,
      );

      const live = await liveTasks(plotId);
      expect(live.every((task) => task.generationBatchId === secondBatch)).toBe(true);
      // Soft-deleted, not removed: a phone holding the old calendar has to be
      // able to learn those tasks are gone.
      const tombstoned = await CalendarTaskModel.countDocuments({
        plotId,
        generationBatchId: firstBatch,
        deletedAt: { $ne: null },
      });
      expect(tombstoned).toBe(body<GenerateBody>(first).tasks.length);
      expect(live[0]?.dueDate).toBe('2026-05-08');
    });
  });

  describe('what a rebuild may not touch', () => {
    it('leaves a manual task alone', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });

      const manualId = randomUUID();
      await request(app)
        .put(`/api/v1/calendar/${manualId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({
          plotId,
          type: 'weeding',
          title: 'Pull the weeds along the bund',
          dueDate: '2026-05-20',
        });

      await generate(actor.token, plotId, {
        sowingDate: '2026-05-08',
        generationBatchId: randomUUID(),
      });

      const survivor = await CalendarTaskModel.findById(manualId).lean<CalendarTask>().exec();
      expect(survivor?.deletedAt).toBeNull();
      expect(survivor?.source).toBe('manual');
    });

    it('leaves a completed task alone', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const first = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });
      const done = body<GenerateBody>(first).tasks[0];
      expect(done).toBeDefined();

      // Set directly rather than through `PATCH /calendar/tasks/:id`: that
      // endpoint arrives in its own section, and what is under test here is
      // what the *generator* does with a done task, not how it got that way.
      await CalendarTaskModel.updateOne(
        { _id: done?._id ?? '' },
        { $set: { status: 'done', completedAt: new Date(), completedOn: SOWN } },
      ).exec();

      await generate(actor.token, plotId, {
        sowingDate: '2026-05-08',
        generationBatchId: randomUUID(),
      });

      const survivor = await CalendarTaskModel.findById(done?._id ?? '')
        .lean<CalendarTask>()
        .exec();
      // A tick records something that happened in a field. Regenerating over
      // it would delete history to tidy up a plan.
      expect(survivor?.deletedAt).toBeNull();
      expect(survivor?.status).toBe('done');
    });

    it('leaves a skipped task alone', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const first = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });
      const skipped = body<GenerateBody>(first).tasks[1];
      expect(skipped).toBeDefined();

      await CalendarTaskModel.updateOne(
        { _id: skipped?._id ?? '' },
        { $set: { status: 'skipped', completedAt: new Date() } },
      ).exec();

      await generate(actor.token, plotId, {
        sowingDate: '2026-05-08',
        generationBatchId: randomUUID(),
      });

      const survivor = await CalendarTaskModel.findById(skipped?._id ?? '')
        .lean<CalendarTask>()
        .exec();
      expect(survivor?.deletedAt).toBeNull();
      expect(survivor?.status).toBe('skipped');
    });

    it('leaves a task the farmer edited alone, even though it is still pending', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      const first = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });
      const edited = body<GenerateBody>(first).tasks[2];
      expect(edited).toBeDefined();

      // The farmer moves a task two days later, without doing it.
      await request(app)
        .patch(`/api/v1/calendar/${edited?._id ?? ''}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ dueDate: '2026-06-01' });

      await generate(actor.token, plotId, {
        sowingDate: '2026-05-08',
        generationBatchId: randomUUID(),
      });

      const survivor = await CalendarTaskModel.findById(edited?._id ?? '')
        .lean<CalendarTask>()
        .exec();
      // `completedOn: null` alone would have let this one go. It is the
      // farmer's correction to the plan, not the generator's to take back.
      expect(survivor?.deletedAt).toBeNull();
      expect(survivor?.isUserEdited).toBe(true);
      expect(survivor?.dueDate).toBe('2026-06-01');
    });
  });

  describe('security', () => {
    it("answers 404, not 403, for another farmer's plot", async () => {
      const owner = await seedFarmer();
      const stranger = await seedFarmer();
      const plotId = await createPlot(owner);

      const response = await generate(stranger.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });

      // A 403 would confirm the id is in use, which is what makes plot ids
      // enumerable. It must be indistinguishable from an id nobody holds.
      expect(response.status).toBe(404);
      expect(body<ErrorBody>(response).error.code).toBe('PLOT_NOT_FOUND');
      expect(await liveTasks(plotId)).toHaveLength(0);
    });

    it('answers 404 for a plot that does not exist', async () => {
      const actor = await seedFarmer();

      const response = await generate(actor.token, randomUUID(), {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });

      expect(response.status).toBe(404);
      expect(body<ErrorBody>(response).error.code).toBe('PLOT_NOT_FOUND');
    });

    it('answers 404 for a deleted plot', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);
      await request(app)
        .delete(`/api/v1/plots/${plotId}`)
        .set('Authorization', `Bearer ${actor.token}`);

      const response = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: randomUUID(),
      });

      expect(response.status).toBe(404);
    });

    it('requires a token', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);

      const response = await request(app)
        .post(`/api/v1/plots/${plotId}/calendar/generate`)
        .send({ sowingDate: SOWN, generationBatchId: randomUUID() });

      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it('rejects a day that does not exist', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);

      const response = await generate(actor.token, plotId, {
        sowingDate: '2026-02-30',
        generationBatchId: randomUUID(),
      });

      expect(response.status).toBe(422);
    });

    it('rejects a timestamp where a day belongs', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);

      const response = await generate(actor.token, plotId, {
        sowingDate: '2026-05-01T00:00:00.000Z',
        generationBatchId: randomUUID(),
      });

      expect(response.status).toBe(422);
    });

    it('rejects a missing batch id', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);

      const response = await generate(actor.token, plotId, { sowingDate: SOWN });

      expect(response.status).toBe(422);
    });

    it('rejects a batch id that is not a UUID v4', async () => {
      const actor = await seedFarmer();
      const plotId = await createPlot(actor);

      const response = await generate(actor.token, plotId, {
        sowingDate: SOWN,
        generationBatchId: 'batch-1',
      });

      expect(response.status).toBe(422);
    });
  });
});
