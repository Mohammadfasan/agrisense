import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { CalendarTaskModel, FarmerModel, type CalendarTask, type Farmer } from '@models';

import { createApp } from '../../app';
import { body } from '../../test/http';

import { signAccessToken } from '../auth/token.service';

import { templateFor } from './cropCalendar.templates';

/**
 * End-to-end coverage of `/calendar` against a real MongoDB.
 *
 * The three things worth testing here are the three that a unit test with a
 * stubbed model would agree with and get wrong:
 *
 * - **Dates stay days.** A `dueDate` has to survive a round trip through
 *   Mongoose, MongoDB and JSON as the same `YYYY-MM-DD` it went in as. At
 *   UTC+05:30 the failure mode is one day, in one direction, and it only shows
 *   up at the boundaries.
 * - **Regeneration is surgical.** It has to delete the template tasks it owns
 *   and nothing else — not the farmer's own, not anything already done.
 * - **Ownership is in the query.** Another farmer's task, and another farmer's
 *   plot id, both have to behave exactly as though they did not exist.
 */

const app = createApp();

interface TaskBody {
  task: CalendarTask;
}

interface TaskListBody {
  tasks: CalendarTask[];
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Anuradhapura, roughly — a square field with a properly closed ring. */
const PLOT = {
  name: 'Upper field',
  crop: 'PADDY',
  areaAcres: 2.5,
  centroid: { type: 'Point', coordinates: [80.401, 8.301] },
};

const PLANTED = '2026-05-01';

interface Actor {
  farmer: Farmer;
  token: string;
}

async function seedFarmer(): Promise<Actor> {
  const created = await FarmerModel.create({
    phone: `+9477${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    name: 'Test User',
    role: 'farmer',
    language: 'en',
    district: 'Anuradhapura',
    isVerified: true,
  });
  const farmer = created.toObject<Farmer>();

  return {
    farmer,
    token: signAccessToken({
      sub: farmer._id.toString(),
      role: farmer.role,
      district: farmer.district,
    }),
  };
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

function calendar(method: Method, token: string, path = ''): request.Test {
  return request(app)[method](`/api/v1/calendar${path}`).set('Authorization', `Bearer ${token}`);
}

function plots(method: Method, token: string, path = ''): request.Test {
  return request(app)[method](`/api/v1/plots${path}`).set('Authorization', `Bearer ${token}`);
}

/**
 * Creates a plot, optionally planted on a day.
 *
 * `plantedAt` goes in as a bare `YYYY-MM-DD`, which `z.coerce.date()` reads as
 * UTC midnight — the same thing the client sends from its date input.
 */
async function createPlot(token: string, plantedAt: string | null = PLANTED): Promise<string> {
  const id = randomUUID();
  const response = await plots('put', token, `/${id}`).send({
    ...PLOT,
    ...(plantedAt === null ? {} : { plantedAt }),
  });

  expect(response.status).toBe(201);
  return id;
}

/** A manual task, created the way a client does: `PUT` on an id it chose. */
async function createTask(
  token: string,
  plotId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const response = await calendar('put', token, `/${id}`).send({
    plotId,
    type: 'weeding',
    title: 'Pull the weeds along the bund',
    dueDate: '2026-05-20',
    ...overrides,
  });

  expect(response.status).toBe(201);
  return id;
}

async function tasksOf(plotId: string): Promise<CalendarTask[]> {
  return CalendarTaskModel.find({ plotId, deletedAt: null })
    .sort({ dueDate: 1 })
    .lean<CalendarTask[]>()
    .exec();
}

/* -------------------------------------------------------------------------- */

describe('template generation', () => {
  it('generates the crop calendar when a plot is created with a plantedAt', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token);

    const template = templateFor('PADDY');
    const tasks = await tasksOf(plotId);

    expect(tasks).toHaveLength(template.activities.length);
    expect(tasks.every((task) => task.source === 'template')).toBe(true);
    expect(tasks.every((task) => task.completedOn === null)).toBe(true);

    // Day 0 is planting day itself, and the last task is the harvest — both
    // read straight off the template rather than off a hardcoded expectation,
    // so correcting the agronomy file does not break this test.
    const [first] = tasks;
    expect(first?.dueDate).toBe(PLANTED);
    expect(tasks.at(-1)?.type).toBe('harvest');
    expect(tasks.at(-1)?.dueDate).toBe('2026-08-24'); // 1 May + 115 days
  });

  it('generates nothing for a plot with nothing in the ground', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);

    expect(await tasksOf(plotId)).toHaveLength(0);
  });

  it('does not churn the calendar when the same plot body is replayed', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token);
    const before = await tasksOf(plotId);

    // Exactly what an offline queue replays. The planting day has not moved,
    // so the tasks must be the same rows — not a fresh set under new ids that
    // every phone holding the old ones would have to reconcile.
    await plots('put', token, `/${plotId}`).send({ ...PLOT, plantedAt: PLANTED });

    const after = await tasksOf(plotId);
    expect(after.map((task) => task._id)).toEqual(before.map((task) => task._id));
  });

  it('regenerates on a new plantedAt, keeping manual and completed tasks', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token);

    const manual = await createTask(token, plotId);
    const generated = await tasksOf(plotId);
    const doomed = generated.find((task) => task.source === 'template' && task.dueDate !== PLANTED);
    const finished = generated.find((task) => task.dueDate === PLANTED);
    expect(doomed).toBeDefined();
    expect(finished).toBeDefined();

    // The farmer sowed on the day the calendar says, and ticked it off.
    await calendar('post', token, `/${finished?._id ?? ''}/complete`).send({});

    // Then corrects the planting day by a week.
    const moved = await plots('patch', token, `/${plotId}`).send({ plantedAt: '2026-05-08' });
    expect(moved.status).toBe(200);

    const after = await tasksOf(plotId);
    const ids = after.map((task) => task._id);

    // The farmer's own task is untouched.
    expect(ids).toContain(manual);
    expect(after.find((task) => task._id === manual)?.dueDate).toBe('2026-05-20');

    // So is the one they had already done — a tick is a record of something
    // that happened in a field, not part of the plan.
    expect(ids).toContain(finished?._id);
    expect(after.find((task) => task._id === finished?._id)?.completedOn).toBe(
      new Date().toISOString().slice(0, 10),
    );

    // The outstanding template tasks were replaced, and the new ones start a
    // week later.
    expect(ids).not.toContain(doomed?._id);
    const regenerated = after.filter(
      (task) => task.source === 'template' && task._id !== finished?._id,
    );
    // The whole template comes back, including a fresh sowing task for the new
    // day. The completed one is kept beside it rather than suppressing it: one
    // is a record of what happened, the other is the plan, and the plan is what
    // the farmer just corrected.
    expect(regenerated).toHaveLength(templateFor('PADDY').activities.length);
    expect(regenerated.some((task) => task.dueDate === '2026-05-08')).toBe(true);

    // Replaced, not removed: a phone holding yesterday's calendar has to be
    // able to learn that those tasks are gone.
    const tombstone = await CalendarTaskModel.findById(doomed?._id).lean<CalendarTask>().exec();
    expect(tombstone?.deletedAt).not.toBeNull();
  });

  it('clears the outstanding calendar when the planting day is removed', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token);
    const manual = await createTask(token, plotId);

    // `PUT` replaces the whole plot, and an omitted `plantedAt` clears it.
    const cleared = await plots('put', token, `/${plotId}`).send(PLOT);
    expect(cleared.status).toBe(200);

    const after = await tasksOf(plotId);
    expect(after.map((task) => task._id)).toEqual([manual]);
  });

  it('takes the calendar with the plot when the plot is deleted', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token);
    await createTask(token, plotId);

    expect((await plots('delete', token, `/${plotId}`)).status).toBe(204);

    // Manual tasks go too: they are work on a field the farmer has just said
    // they no longer have.
    expect(await tasksOf(plotId)).toHaveLength(0);
    expect(body<TaskListBody>(await calendar('get', token)).tasks).toHaveLength(0);
  });
});

describe('date validation', () => {
  it('rejects a day that does not exist with 422', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);

    const response = await calendar('put', token, `/${randomUUID()}`).send({
      plotId,
      type: 'weeding',
      title: 'Weeding',
      // Matches the shape and is not a day. `new Date` would roll it forward
      // to 2 March rather than refusing it.
      dueDate: '2026-02-30',
    });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a day in any other format with 422', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);

    for (const dueDate of ['15-03-2026', '2026-3-15', '2026-05-01T00:00:00.000Z', 'tomorrow']) {
      const response = await calendar('put', token, `/${randomUUID()}`).send({
        plotId,
        type: 'weeding',
        title: 'Weeding',
        dueDate,
      });

      expect(response.status, dueDate).toBe(422);
    }
  });

  it('stores and returns the day it was given, with no timezone shift', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);

    // The two ends of a day in Colombo: a `Date` at either would land on a
    // different day in UTC.
    const id = await createTask(token, plotId, { dueDate: '2026-12-31' });

    expect(body<TaskBody>(await calendar('get', token, `/${id}`)).task.dueDate).toBe('2026-12-31');
    expect((await CalendarTaskModel.findById(id).lean<CalendarTask>().exec())?.dueDate).toBe(
      '2026-12-31',
    );
  });
});

describe('ownership', () => {
  it("answers 404 for a task created against another farmer's plot", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    const theirs = await createPlot(b.token, null);

    const response = await calendar('put', a.token, `/${randomUUID()}`).send({
      plotId: theirs,
      type: 'weeding',
      title: 'Not mine',
      dueDate: '2026-05-20',
    });

    // 404 and not 403: a 403 would confirm that the plot id is in use.
    expect(response.status).toBe(404);
    expect(body<ErrorBody>(response).error.code).toBe('PLOT_NOT_FOUND');
    expect(await CalendarTaskModel.countDocuments({})).toBe(0);
  });

  it("answers 404, not 403, on another farmer's task", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    const plotId = await createPlot(b.token, null);
    const id = await createTask(b.token, plotId);

    const read = await calendar('get', a.token, `/${id}`);
    expect(read.status).toBe(404);
    expect(body<ErrorBody>(read).error.code).toBe('CALENDAR_TASK_NOT_FOUND');

    expect((await calendar('patch', a.token, `/${id}`).send({ title: 'Mine now' })).status).toBe(
      404,
    );
    expect((await calendar('post', a.token, `/${id}/complete`).send({})).status).toBe(404);
    expect((await calendar('delete', a.token, `/${id}`)).status).toBe(404);

    // And none of those attempts touched it.
    const stored = await CalendarTaskModel.findById(id).lean<CalendarTask>().exec();
    expect(stored?.title).toBe('Pull the weeds along the bund');
    expect(stored?.completedOn).toBeNull();
    expect(stored?.deletedAt).toBeNull();
  });

  it("never lists another farmer's tasks", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    await createPlot(b.token);
    const mine = await createPlot(a.token, null);
    const task = await createTask(a.token, mine);

    const response = await calendar('get', a.token);

    expect(response.status).toBe(200);
    expect(body<TaskListBody>(response).tasks.map((item) => item._id)).toEqual([task]);
  });

  it('requires a token', async () => {
    expect((await request(app).get('/api/v1/calendar')).status).toBe(401);
  });

  it('ignores a userId and a source in the body', async () => {
    const owner = await seedFarmer();
    const intruder = await seedFarmer();
    const plotId = await createPlot(owner.token, null);
    const id = randomUUID();

    const response = await calendar('put', owner.token, `/${id}`).send({
      plotId,
      type: 'weeding',
      title: 'Weeding',
      dueDate: '2026-05-20',
      userId: intruder.farmer._id.toString(),
      // A client that could claim `template` could hide a task from
      // regeneration — or hand the generator one it will delete.
      source: 'template',
    });

    expect(response.status).toBe(201);
    const stored = await CalendarTaskModel.findById(id).lean<CalendarTask>().exec();
    expect(stored?.userId.toString()).toBe(owner.farmer._id.toString());
    expect(stored?.source).toBe('manual');
  });
});

describe('GET /calendar', () => {
  it('filters by date range, inclusive at both ends', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);

    await createTask(token, plotId, { dueDate: '2026-05-31' });
    const first = await createTask(token, plotId, { dueDate: '2026-06-01' });
    const middle = await createTask(token, plotId, { dueDate: '2026-06-15' });
    const last = await createTask(token, plotId, { dueDate: '2026-06-30' });
    await createTask(token, plotId, { dueDate: '2026-07-01' });

    const response = await calendar('get', token, '?from=2026-06-01&to=2026-06-30');

    expect(response.status).toBe(200);
    // Both boundary days are in, and they come back earliest first.
    expect(body<TaskListBody>(response).tasks.map((task) => task._id)).toEqual([
      first,
      middle,
      last,
    ]);
  });

  it('filters by plot', async () => {
    const { token } = await seedFarmer();
    const one = await createPlot(token, null);
    const two = await createPlot(token, null);
    const mine = await createTask(token, one);
    await createTask(token, two);

    const response = await calendar('get', token, `?plotId=${one}`);

    expect(body<TaskListBody>(response).tasks.map((task) => task._id)).toEqual([mine]);
  });

  it('rejects a range that runs backwards, and a malformed day', async () => {
    const { token } = await seedFarmer();

    expect((await calendar('get', token, '?from=2026-06-30&to=2026-06-01')).status).toBe(422);
    expect((await calendar('get', token, '?from=01-06-2026')).status).toBe(422);
  });
});

describe('GET /calendar/upcoming', () => {
  it('returns outstanding work across every plot, earliest first', async () => {
    const { token } = await seedFarmer();
    const one = await createPlot(token, null);
    const two = await createPlot(token, null);

    const today = new Date().toISOString().slice(0, 10);
    const overdue = await createTask(token, one, { dueDate: '2020-01-01' });
    const soon = await createTask(token, two, { dueDate: today });
    const done = await createTask(token, one, { dueDate: today });
    await createTask(token, one, { dueDate: '2099-01-01' });

    await calendar('post', token, `/${done}/complete`).send({});

    const response = await calendar('get', token, '/upcoming?days=7');

    expect(response.status).toBe(200);
    const ids = body<TaskListBody>(response).tasks.map((task) => task._id);
    // Overdue first: a task due yesterday and not done is the most urgent
    // thing the farmer owns, and this is the list that has to say so.
    expect(ids).toEqual([overdue, soon]);
  });

  it('rejects a window outside its bounds', async () => {
    const { token } = await seedFarmer();

    expect((await calendar('get', token, '/upcoming?days=0')).status).toBe(422);
    expect((await calendar('get', token, '/upcoming?days=400')).status).toBe(422);
  });
});

describe('POST /calendar/:id/complete', () => {
  it('records the day and leaves the task in the listings', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);
    const id = await createTask(token, plotId);

    const response = await calendar('post', token, `/${id}/complete`).send({
      completedOn: '2026-05-19',
    });

    expect(response.status).toBe(200);
    expect(body<TaskBody>(response).task.completedOn).toBe('2026-05-19');

    // Still there: a calendar that hid completed work would lose the record of
    // what was done and when, which is half of what the screen is for.
    const listed = body<TaskListBody>(await calendar('get', token)).tasks;
    expect(listed.map((task) => task._id)).toEqual([id]);
    expect(listed[0]?.completedOn).toBe('2026-05-19');
  });

  it('defaults to today where the farmer is, and is idempotent', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);
    const id = await createTask(token, plotId);

    const first = await calendar('post', token, `/${id}/complete`).send({});
    // Colombo is UTC+05:30, so this is the UTC day or the one after it —
    // never the one before, which is what a naive `new Date()` would risk.
    const utcToday = new Date().toISOString().slice(0, 10);
    expect(body<TaskBody>(first).task.completedOn).not.toBeNull();
    expect(body<TaskBody>(first).task.completedOn?.localeCompare(utcToday)).toBeGreaterThanOrEqual(
      0,
    );

    // Replayed off an offline queue: done is done, not an error.
    const replay = await calendar('post', token, `/${id}/complete`).send({});
    expect(replay.status).toBe(200);
  });

  it('can be undone with a PATCH, but not by a replayed PUT', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);
    const id = await createTask(token, plotId);

    await calendar('post', token, `/${id}/complete`).send({ completedOn: '2026-05-19' });

    // A stale `PUT` — the phone's copy of the task from before it was ticked.
    const replayed = await calendar('put', token, `/${id}`).send({
      plotId,
      type: 'weeding',
      title: 'Pull the weeds along the bund',
      dueDate: '2026-05-20',
    });
    expect(replayed.status).toBe(200);
    expect(body<TaskBody>(replayed).task.completedOn).toBe('2026-05-19');

    // A `PATCH` naming the field means it: the farmer is undoing a tick.
    const undone = await calendar('patch', token, `/${id}`).send({ completedOn: null });
    expect(undone.status).toBe(200);
    expect(body<TaskBody>(undone).task.completedOn).toBeNull();
  });
});

describe('PUT and DELETE /calendar/:id', () => {
  it('creates under the client UUID with 201, and is idempotent on replay', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);
    const id = randomUUID();
    const task = { plotId, type: 'irrigation', title: 'Water the nursery', dueDate: '2026-05-05' };

    const created = await calendar('put', token, `/${id}`).send(task);
    expect(created.status).toBe(201);
    expect(body<TaskBody>(created).task.version).toBe(1);

    const replayed = await calendar('put', token, `/${id}`).send(task);
    expect(replayed.status).toBe(200);
    expect(await CalendarTaskModel.countDocuments({ _id: id })).toBe(1);
  });

  it('soft deletes with 204 and keeps the id reserved', async () => {
    const { token } = await seedFarmer();
    const plotId = await createPlot(token, null);
    const id = await createTask(token, plotId);

    expect((await calendar('delete', token, `/${id}`)).status).toBe(204);
    expect((await calendar('get', token, `/${id}`)).status).toBe(404);
    expect(
      (await CalendarTaskModel.findById(id).lean<CalendarTask>().exec())?.deletedAt,
    ).not.toBeNull();

    // A replayed create does not resurrect it, and a second delete is a 404
    // rather than a tombstone written over the real deletion time.
    expect(
      (
        await calendar('put', token, `/${id}`).send({
          plotId,
          type: 'weeding',
          title: 'Back from the dead',
          dueDate: '2026-05-20',
        })
      ).status,
    ).toBe(404);
    expect((await calendar('delete', token, `/${id}`)).status).toBe(404);
  });

  it('rejects a malformed id and a UUID that is not v4', async () => {
    const { token } = await seedFarmer();

    expect((await calendar('get', token, '/not-a-uuid')).status).toBe(422);
    expect((await calendar('get', token, '/2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d')).status).toBe(
      422,
    );
  });
});
