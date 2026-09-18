import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { CalendarTaskModel, type CalendarTask } from '@models';

import { createApp } from '../../app';
import { seedFarmer, type Actor } from '../../test/actors';
import { body } from '../../test/http';

/**
 * `PATCH /calendar/tasks/:id` — the status write, and its version check.
 *
 * The concurrency case is the one worth the setup. Two phones hold the same
 * calendar offline and both tick the same task; the losing write has to be
 * told, and told with enough detail to show the farmer what actually happened.
 * A last-write-wins endpoint passes every other test in this file.
 */

const app = createApp();

const PLOT = {
  name: 'Upper field',
  crop: 'PADDY',
  areaAcres: 2.5,
  centroid: { type: 'Point', coordinates: [80.401, 8.301] },
};

interface TaskBody {
  task: CalendarTask;
}

interface ErrorBody {
  error: { code: string; message: string; details?: { task: CalendarTask } };
}

async function createPlot(actor: Actor): Promise<string> {
  const id = randomUUID();
  const response = await request(app)
    .put(`/api/v1/plots/${id}`)
    .set('Authorization', `Bearer ${actor.token}`)
    .send(PLOT);

  expect(response.status).toBe(201);
  return id;
}

/** A pending task at a known version. */
async function createTask(actor: Actor, plotId: string): Promise<CalendarTask> {
  const id = randomUUID();
  const created = await CalendarTaskModel.create({
    _id: id,
    userId: actor.farmer._id,
    plotId,
    type: 'irrigation',
    title: 'calendar.task.paddy.midSeasonWater.title',
    dueDate: '2026-06-10',
    status: 'pending',
    source: 'template',
    isUserEdited: false,
    version: 1,
  });
  return created.toObject<CalendarTask>();
}

function patchStatus(
  token: string,
  taskId: string,
  payload: Record<string, unknown>,
): request.Test {
  return request(app)
    .patch(`/api/v1/calendar/tasks/${taskId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
}

/* -------------------------------------------------------------------------- */

describe('PATCH /calendar/tasks/:id', () => {
  describe('on success', () => {
    it('marks a task done, stamping both records of completion', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 1,
      });

      expect(response.status).toBe(200);
      const updated = body<TaskBody>(response).task;
      expect(updated.status).toBe('done');
      expect(updated.completedAt).not.toBeNull();
      // The day, as well as the instant: Day 11's `/upcoming` and the client
      // both read `completedOn`, and the two disagreeing would be worse than
      // either being absent.
      expect(updated.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('increments the version', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 1,
      });

      expect(body<TaskBody>(response).task.version).toBe(2);
    });

    it('sets isUserEdited, so a rebuild can no longer clear the task', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 1,
      });

      expect(body<TaskBody>(response).task.isUserEdited).toBe(true);
    });

    it('marks a task skipped without claiming a day the work happened on', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'skipped',
        version: 1,
      });

      const updated = body<TaskBody>(response).task;
      expect(updated.status).toBe('skipped');
      // There is a moment the farmer decided, and no day on which the work was
      // carried out. Writing one would make the two fields contradict.
      expect(updated.completedAt).not.toBeNull();
      expect(updated.completedOn).toBeNull();
    });

    it('returns a task to pending, clearing both completion records', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));
      await patchStatus(actor.token, task._id, { status: 'done', version: 1 });

      const response = await patchStatus(actor.token, task._id, {
        status: 'pending',
        version: 2,
      });

      const updated = body<TaskBody>(response).task;
      expect(updated.status).toBe('pending');
      expect(updated.completedAt).toBeNull();
      expect(updated.completedOn).toBeNull();
    });

    it('allows a sequence of changes, each with the version it produced', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      await patchStatus(actor.token, task._id, { status: 'done', version: 1 });
      await patchStatus(actor.token, task._id, { status: 'pending', version: 2 });
      const third = await patchStatus(actor.token, task._id, {
        status: 'skipped',
        version: 3,
      });

      expect(third.status).toBe(200);
      expect(body<TaskBody>(third).task.version).toBe(4);
    });
  });

  describe('optimistic concurrency', () => {
    it('answers 409 when the stored version has moved on', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      // The first phone wins.
      await patchStatus(actor.token, task._id, { status: 'done', version: 1 });
      // The second replays the version it was holding.
      const stale = await patchStatus(actor.token, task._id, {
        status: 'skipped',
        version: 1,
      });

      expect(stale.status).toBe(409);
      expect(body<ErrorBody>(stale).error.code).toBe('CALENDAR_TASK_VERSION_CONFLICT');
    });

    it('returns the current server record with the conflict', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));
      await patchStatus(actor.token, task._id, { status: 'done', version: 1 });

      const stale = await patchStatus(actor.token, task._id, {
        status: 'skipped',
        version: 1,
      });

      // Enough to show the farmer what happened, without a second request in
      // the one moment the app most needs to have an answer ready.
      const current = body<ErrorBody>(stale).error.details?.task;
      expect(current?.status).toBe('done');
      expect(current?.version).toBe(2);
    });

    it('does not apply the losing write', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));
      await patchStatus(actor.token, task._id, { status: 'done', version: 1 });

      await patchStatus(actor.token, task._id, { status: 'skipped', version: 1 });

      const stored = await CalendarTaskModel.findById(task._id).lean<CalendarTask>().exec();
      expect(stored?.status).toBe('done');
      expect(stored?.version).toBe(2);
    });

    it('answers 409 for a version ahead of the stored one, not only behind', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 99,
      });

      // A client that has invented a version is as wrong as one that is stale,
      // and letting it through would make the check decorative.
      expect(response.status).toBe(409);
    });

    it('lets exactly one of two concurrent writes through', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const [first, second] = await Promise.all([
        patchStatus(actor.token, task._id, { status: 'done', version: 1 }),
        patchStatus(actor.token, task._id, { status: 'skipped', version: 1 }),
      ]);

      // The compare and the write are one operation, so there is no window
      // between them for both to pass. Which one wins is not determined; that
      // exactly one does is.
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  describe('errors', () => {
    it('answers 404 for a task that does not exist', async () => {
      const actor = await seedFarmer();

      const response = await patchStatus(actor.token, randomUUID(), {
        status: 'done',
        version: 1,
      });

      expect(response.status).toBe(404);
      expect(body<ErrorBody>(response).error.code).toBe('CALENDAR_TASK_NOT_FOUND');
    });

    it("answers 404, not 403 or 409, for another farmer's task", async () => {
      const owner = await seedFarmer();
      const stranger = await seedFarmer();
      const task = await createTask(owner, await createPlot(owner));

      const response = await patchStatus(stranger.token, task._id, {
        status: 'done',
        version: 1,
      });

      // A 409 would leak that the id exists just as surely as a 403 would.
      expect(response.status).toBe(404);
      expect(body<ErrorBody>(response).error.code).toBe('CALENDAR_TASK_NOT_FOUND');
    });

    it('answers 404 for a deleted task', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));
      await request(app)
        .delete(`/api/v1/calendar/${task._id}`)
        .set('Authorization', `Bearer ${actor.token}`);

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 1,
      });

      expect(response.status).toBe(404);
    });

    it('rejects a body with no version', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, { status: 'done' });

      expect(response.status).toBe(422);
    });

    it('rejects a status outside the vocabulary', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'complete',
        version: 1,
      });

      expect(response.status).toBe(422);
    });

    it('ignores a completedAt a client tries to set', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await patchStatus(actor.token, task._id, {
        status: 'done',
        version: 1,
        completedAt: '1999-01-01T00:00:00.000Z',
        completedOn: '1999-01-01',
      });

      // Stripped by Zod. A client that could set these could record work as
      // done on a day it was not, and the pair would drift apart.
      const updated = body<TaskBody>(response).task;
      expect(updated.completedOn).not.toBe('1999-01-01');
      expect(new Date(updated.completedAt ?? 0).getFullYear()).toBeGreaterThan(2020);
    });

    it('rejects an id that is not a UUID v4', async () => {
      const actor = await seedFarmer();

      const response = await patchStatus(actor.token, 'not-a-uuid', {
        status: 'done',
        version: 1,
      });

      expect(response.status).toBe(422);
    });

    it('requires a token', async () => {
      const actor = await seedFarmer();
      const task = await createTask(actor, await createPlot(actor));

      const response = await request(app)
        .patch(`/api/v1/calendar/tasks/${task._id}`)
        .send({ status: 'done', version: 1 });

      expect(response.status).toBe(401);
    });
  });
});
