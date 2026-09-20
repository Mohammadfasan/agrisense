import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { CalendarTaskModel, type CalendarTask } from '@models';
import { ErrorCode } from '@shared';

import { createApp } from '../../app';
import { seedFarmer, type Actor } from '../../test/actors';
import { body } from '../../test/http';

/**
 * The error contract of every calendar route, swept in one place.
 *
 * The other files in this module each test what one endpoint *does*, and
 * check the error shape of the cases they happen to pass through. This one
 * asks the question the other way round: for every route, and every surface
 * that takes an id or a day, is the answer an `AppError` with a code from the
 * published vocabulary — or is it something Mongoose wrote?
 *
 * **Why a raw Mongoose error is the thing being hunted.** The calendar's ids
 * are client-minted UUID v4s stored as `_id` strings, so a malformed one does
 * not throw a `CastError` on its own — it simply matches nothing, and a route
 * that forgot to parse it would answer a plausible `404` and pass every
 * functional test in this module. The one input that does not fail quietly is
 * a 24-character hex string: that is exactly what Mongoose casts into an
 * `ObjectId` without complaint, so it is the value that tells a route which
 * parsed its id from a route that did not. Every id sweep below includes one.
 *
 * **What a stable code buys.** The client branches on `error.code` --
 * `VERSION_CONFLICT` in `api/calendar.ts` is the live example — and a route
 * that leaked `CastError`, or answered a bare `500`, would break that branch
 * without changing a status anybody is watching.
 */

const app = createApp();

const PLOT = {
  name: 'Upper field',
  crop: 'PADDY',
  areaAcres: 2.5,
  centroid: { type: 'Point', coordinates: [80.401, 8.301] },
};

interface ErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

/** Every code the API is allowed to answer with, as published on `ErrorCode`. */
const KNOWN_CODES: readonly string[] = Object.values(ErrorCode);

/**
 * Ids that are not UUID v4s.
 *
 * `OBJECT_ID_SHAPED` is the load-bearing one — see the note at the top of the
 * file. The v1 UUID is here because `uuidV4Schema` refuses versions other than
 * 4 on purpose, and a route reaching for Zod's own `.uuid()` would take it.
 */
const OBJECT_ID_SHAPED = '507f1f77bcf86cd799439011';
const BAD_IDS: readonly [string, string][] = [
  ['plain text', 'not-a-uuid'],
  ['an ObjectId-shaped hex string', OBJECT_ID_SHAPED],
  ['a UUID v1', 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6'],
  ['a truncated UUID', '3f2504e0-4f89-41d3-9a0c'],
  ['the string "null"', 'null'],
];

/**
 * Days that are not days.
 *
 * The first two are the ones a regex alone lets through: both match
 * `YYYY-MM-DD` and neither exists, and `new Date` rolls both silently forward
 * rather than failing. The timestamp is the other direction — a value that is
 * a real instant and still not a day, which is the distinction the whole of
 * `dateString.ts` exists to hold.
 */
const BAD_DAYS: readonly [string, string][] = [
  ['a day that does not exist', '2026-02-30'],
  ['a month that does not exist', '2026-13-01'],
  ['29 February in a common year', '2027-02-29'],
  ['a timestamp', '2026-06-10T00:00:00.000Z'],
  ['a day written the other way round', '10-06-2026'],
  ['an unpadded day', '2026-6-1'],
  ['a word', 'today'],
];

/* -------------------------------------------------------------------------- */

async function createPlot(actor: Actor): Promise<string> {
  const id = randomUUID();
  const response = await request(app)
    .put(`/api/v1/plots/${id}`)
    .set('Authorization', `Bearer ${actor.token}`)
    .send(PLOT);

  expect(response.status).toBe(201);
  return id;
}

async function createTask(actor: Actor, plotId: string): Promise<CalendarTask> {
  const created = await CalendarTaskModel.create({
    _id: randomUUID(),
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

/**
 * The assertion every case in this file shares.
 *
 * Checks the envelope rather than the message: a code from the published set,
 * a request id to correlate the log by, and no fingerprint of the driver. The
 * message itself is not asserted — it is prose, and pinning it would make this
 * file fail on a rewording that changed nothing a client can see.
 */
function expectStableError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);

  const payload = body<ErrorBody>(response);
  expect(payload.error.code).toBe(code);
  expect(KNOWN_CODES).toContain(payload.error.code);
  // Every response is correlatable with the line the error handler logged.
  expect(payload.error.requestId).toEqual(expect.any(String));
  expect(payload.error.requestId.length).toBeGreaterThan(0);

  // Nothing Mongoose wrote. `CastError` and `stringValue` are its own fields,
  // and "Cast to" opens the message it builds; a route that let one through
  // would be leaking the schema's internals into a client contract.
  const serialised = JSON.stringify(payload);
  expect(serialised).not.toMatch(/CastError|ValidatorError|stringValue|Cast to |\bBSONError\b/);
  expect(payload.error.message).not.toMatch(/mongo|mongoose|ObjectId/i);
}

/** 422 with the validation code: the answer to every malformed input below. */
function expectValidationError(response: request.Response): void {
  expectStableError(response, 422, ErrorCode.VALIDATION_ERROR);
}

/* -------------------------------------------------------------------------- */
/* Malformed ids                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every route that takes an id in its path.
 *
 * A malformed id is a `422`, not a `404`. The two are different statements: a
 * `404` says "no task of yours has that id", which is a claim about the
 * collection, and no string of this shape could ever name one. Answering `404`
 * would also mean the route had reached the database to find that out.
 */
describe('a malformed id in the path', () => {
  const routes: readonly [string, (token: string, id: string) => request.Test][] = [
    [
      'GET /calendar/:id',
      (token, id) => request(app).get(`/api/v1/calendar/${id}`).auth(token, { type: 'bearer' }),
    ],
    [
      'PUT /calendar/:id',
      (token, id) =>
        request(app)
          .put(`/api/v1/calendar/${id}`)
          .auth(token, { type: 'bearer' })
          .send({
            plotId: randomUUID(),
            type: 'weeding',
            title: 'Weed the bund',
            dueDate: '2026-06-10',
          }),
    ],
    [
      'PATCH /calendar/:id',
      (token, id) =>
        request(app)
          .patch(`/api/v1/calendar/${id}`)
          .auth(token, { type: 'bearer' })
          .send({ title: 'Renamed' }),
    ],
    [
      'DELETE /calendar/:id',
      (token, id) => request(app).delete(`/api/v1/calendar/${id}`).auth(token, { type: 'bearer' }),
    ],
    [
      'POST /calendar/:id/complete',
      (token, id) =>
        request(app)
          .post(`/api/v1/calendar/${id}/complete`)
          .auth(token, { type: 'bearer' })
          .send({}),
    ],
    [
      'PATCH /calendar/tasks/:id',
      (token, id) =>
        request(app)
          .patch(`/api/v1/calendar/tasks/${id}`)
          .auth(token, { type: 'bearer' })
          .send({ status: 'done', version: 1 }),
    ],
    [
      'POST /plots/:plotId/calendar/generate',
      (token, id) =>
        request(app)
          .post(`/api/v1/plots/${id}/calendar/generate`)
          .auth(token, { type: 'bearer' })
          .send({ sowingDate: '2026-05-01', generationBatchId: randomUUID() }),
    ],
  ];

  for (const [name, call] of routes) {
    describe(name, () => {
      for (const [label, id] of BAD_IDS) {
        it(`answers 422 for ${label}`, async () => {
          const actor = await seedFarmer();

          expectValidationError(await call(actor.token, id));
        });
      }
    });
  }
});

describe('a malformed id in a body or query', () => {
  it('rejects a plotId query that is not a UUID v4', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .get('/api/v1/calendar')
      .query({ plotId: OBJECT_ID_SHAPED })
      .auth(actor.token, { type: 'bearer' });

    expectValidationError(response);
  });

  it('rejects a plotId in a PUT body that is not a UUID v4', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .put(`/api/v1/calendar/${randomUUID()}`)
      .auth(actor.token, { type: 'bearer' })
      .send({
        plotId: OBJECT_ID_SHAPED,
        type: 'weeding',
        title: 'Weed the bund',
        dueDate: '2026-06-10',
      });

    expectValidationError(response);
  });

  it('rejects a generationBatchId that is not a UUID v4', async () => {
    const actor = await seedFarmer();
    const plotId = await createPlot(actor);

    const response = await request(app)
      .post(`/api/v1/plots/${plotId}/calendar/generate`)
      .auth(actor.token, { type: 'bearer' })
      .send({ sowingDate: '2026-05-01', generationBatchId: OBJECT_ID_SHAPED });

    expectValidationError(response);
  });

  /**
   * A well-formed id naming nothing is the other half of the pair: it reaches
   * the database, finds no plot, and still answers a published code rather
   * than anything the driver produced.
   */
  it('answers PLOT_NOT_FOUND, not a cast error, for a well-formed plotId nobody owns', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .put(`/api/v1/calendar/${randomUUID()}`)
      .auth(actor.token, { type: 'bearer' })
      .send({
        plotId: randomUUID(),
        type: 'weeding',
        title: 'Weed the bund',
        dueDate: '2026-06-10',
      });

    expectStableError(response, 404, ErrorCode.PLOT_NOT_FOUND);
  });

  it('answers CALENDAR_TASK_NOT_FOUND for a well-formed task id nobody owns', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .get(`/api/v1/calendar/${randomUUID()}`)
      .auth(actor.token, { type: 'bearer' });

    expectStableError(response, 404, ErrorCode.CALENDAR_TASK_NOT_FOUND);
  });
});

/* -------------------------------------------------------------------------- */
/* Malformed days                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every surface that takes a `YYYY-MM-DD`.
 *
 * `dateString.ts` throws a `RangeError` on a day that does not exist, and a
 * `RangeError` reaching the error handler is a `500` marked as a defect. That
 * is the correct behaviour *there* — a service reached with a bad day has a
 * caller with a bug — and it is only correct because no request can get that
 * far. These cases are what keeps that true: every day a client can send is
 * refused at the schema, as a `422`, before any arithmetic sees it.
 */
describe('a malformed day', () => {
  const surfaces: readonly [string, (actor: Actor, day: string) => Promise<request.Response>][] = [
    [
      'GET /calendar?from=',
      async (actor, day) =>
        request(app)
          .get('/api/v1/calendar')
          .query({ from: day })
          .auth(actor.token, { type: 'bearer' }),
    ],
    [
      'GET /calendar?to=',
      async (actor, day) =>
        request(app)
          .get('/api/v1/calendar')
          .query({ to: day })
          .auth(actor.token, { type: 'bearer' }),
    ],
    [
      'GET /calendar/today?date=',
      async (actor, day) =>
        request(app)
          .get('/api/v1/calendar/today')
          .query({ date: day })
          .auth(actor.token, { type: 'bearer' }),
    ],
    [
      'PUT /calendar/:id dueDate',
      async (actor, day) =>
        request(app)
          .put(`/api/v1/calendar/${randomUUID()}`)
          .auth(actor.token, { type: 'bearer' })
          .send({
            plotId: await createPlot(actor),
            type: 'weeding',
            title: 'Weed the bund',
            dueDate: day,
          }),
    ],
    [
      'PATCH /calendar/:id dueDate',
      async (actor, day) => {
        const task = await createTask(actor, await createPlot(actor));
        return request(app)
          .patch(`/api/v1/calendar/${task._id}`)
          .auth(actor.token, { type: 'bearer' })
          .send({ dueDate: day });
      },
    ],
    [
      'PATCH /calendar/:id completedOn',
      async (actor, day) => {
        const task = await createTask(actor, await createPlot(actor));
        return request(app)
          .patch(`/api/v1/calendar/${task._id}`)
          .auth(actor.token, { type: 'bearer' })
          .send({ completedOn: day });
      },
    ],
    [
      'POST /calendar/:id/complete completedOn',
      async (actor, day) => {
        const task = await createTask(actor, await createPlot(actor));
        return request(app)
          .post(`/api/v1/calendar/${task._id}/complete`)
          .auth(actor.token, { type: 'bearer' })
          .send({ completedOn: day });
      },
    ],
    [
      'POST /plots/:plotId/calendar/generate sowingDate',
      async (actor, day) =>
        request(app)
          .post(`/api/v1/plots/${await createPlot(actor)}/calendar/generate`)
          .auth(actor.token, { type: 'bearer' })
          .send({ sowingDate: day, generationBatchId: randomUUID() }),
    ],
  ];

  for (const [name, call] of surfaces) {
    describe(name, () => {
      for (const [label, day] of BAD_DAYS) {
        it(`answers 422 for ${label}`, async () => {
          const actor = await seedFarmer();

          expectValidationError(await call(actor, day));
        });
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* The rest of the envelope                                                    */
/* -------------------------------------------------------------------------- */

describe('the error envelope', () => {
  it('names the field that failed, so a client can say which one', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .get('/api/v1/calendar')
      .query({ from: '2026-02-30' })
      .auth(actor.token, { type: 'bearer' });

    // `parseOrThrow` flattens Zod's issues to `{ path, message }`. The path is
    // what lets a form highlight a field rather than showing a banner.
    expect(body<ErrorBody>(response).error.details).toEqual([
      expect.objectContaining({ path: 'from' }),
    ]);
  });

  it('rejects a range that runs backwards with the same code as a malformed day', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .get('/api/v1/calendar')
      .query({ from: '2026-06-10', to: '2026-06-01' })
      .auth(actor.token, { type: 'bearer' });

    // A refinement rather than a field shape, and still a `VALIDATION_ERROR`:
    // the client has one branch for "you sent something wrong", not two.
    expectValidationError(response);
  });

  it('answers a stable code without a token, on every calendar route', async () => {
    const routes = [
      request(app).get('/api/v1/calendar'),
      request(app).get('/api/v1/calendar/upcoming'),
      request(app).get('/api/v1/calendar/today'),
      request(app).get(`/api/v1/calendar/${randomUUID()}`),
      request(app)
        .patch(`/api/v1/calendar/tasks/${randomUUID()}`)
        .send({ status: 'done', version: 1 }),
      request(app)
        .post(`/api/v1/plots/${randomUUID()}/calendar/generate`)
        .send({ sowingDate: '2026-05-01', generationBatchId: randomUUID() }),
    ];

    for (const response of await Promise.all(routes)) {
      expect(response.status).toBe(401);
      expect(KNOWN_CODES).toContain(body<ErrorBody>(response).error.code);
    }
  });

  it('answers a stable code for malformed JSON rather than a parser stack', async () => {
    const actor = await seedFarmer();

    const response = await request(app)
      .patch(`/api/v1/calendar/${randomUUID()}`)
      .auth(actor.token, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    // Express' body parser throws a `SyntaxError`; `errorHandler` maps it.
    expectStableError(response, 400, ErrorCode.BAD_REQUEST);
  });

  it('rejects a status outside the vocabulary with the validation code', async () => {
    const actor = await seedFarmer();
    const task = await createTask(actor, await createPlot(actor));

    const response = await request(app)
      .patch(`/api/v1/calendar/tasks/${task._id}`)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'nearly', version: 1 });

    expectValidationError(response);
  });

  it('answers the version conflict with its own code, not a bare CONFLICT', async () => {
    const actor = await seedFarmer();
    const task = await createTask(actor, await createPlot(actor));

    await request(app)
      .patch(`/api/v1/calendar/tasks/${task._id}`)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'done', version: 1 });

    const stale = await request(app)
      .patch(`/api/v1/calendar/tasks/${task._id}`)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'skipped', version: 1 });

    // The client branches on exactly this string — see `VERSION_CONFLICT` in
    // `client/src/api/calendar.ts`. A bare `CONFLICT` would break that branch
    // without changing the status anybody is watching.
    expectStableError(stale, 409, ErrorCode.CALENDAR_TASK_VERSION_CONFLICT);
  });
});
