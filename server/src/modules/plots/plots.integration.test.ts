import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { FarmerModel, PlotModel, type Farmer, type FarmerRole, type Plot } from '@models';

import { createApp } from '../../app';
import { body } from '../../test/http';

import { signAccessToken } from '../auth/token.service';

/**
 * End-to-end coverage of `/plots` against a real MongoDB.
 *
 * The things that can actually go wrong here are all at boundaries a stubbed
 * service would skip: whether the upsert on a client UUID is genuinely
 * idempotent, whether another farmer's id leaks through as a 403 or a 200,
 * whether a tombstone really keeps its id, and whether paging holds up when
 * rows move under the reader. So the tests go through Express and out to the
 * collection.
 */

const app = createApp();

interface PlotBody {
  plot: Plot;
}

interface PlotListBody {
  plots: Plot[];
  nextCursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Anuradhapura, roughly — a square field with a properly closed ring. */
const BOUNDARY = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [80.4, 8.3],
      [80.402, 8.3],
      [80.402, 8.302],
      [80.4, 8.302],
      [80.4, 8.3],
    ],
  ],
};

const FULL_PLOT = {
  name: 'Upper field',
  crop: 'PADDY',
  areaAcres: 2.5,
  boundary: BOUNDARY,
  plantedAt: '2026-05-01T00:00:00.000Z',
  notes: 'Waterlogs near the bund after heavy rain.',
};

interface Actor {
  farmer: Farmer;
  token: string;
}

async function seedFarmer(role: FarmerRole = 'farmer'): Promise<Actor> {
  const created = await FarmerModel.create({
    phone: `+9477${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    name: 'Test User',
    role,
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

type Method = 'get' | 'put' | 'patch' | 'delete';

function authed(method: Method, token: string, path = ''): request.Test {
  return request(app)[method](`/api/v1/plots${path}`).set('Authorization', `Bearer ${token}`);
}

/** Creates a plot and returns its id, failing loudly if the create did not. */
async function createPlot(token: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const response = await authed('put', token, `/${id}`).send({ ...FULL_PLOT, ...overrides });

  expect(response.status).toBe(201);
  return id;
}

/* -------------------------------------------------------------------------- */

describe('PUT /plots/:id', () => {
  it('creates under the client UUID with 201, and is idempotent on replay', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();

    const created = await authed('put', token, `/${id}`).send(FULL_PLOT);

    expect(created.status).toBe(201);
    expect(body<PlotBody>(created).plot._id).toBe(id);
    expect(body<PlotBody>(created).plot.version).toBe(1);

    // The same call again — which is exactly what an offline queue replays.
    const replayed = await authed('put', token, `/${id}`).send(FULL_PLOT);

    expect(replayed.status).toBe(200);
    expect(body<PlotBody>(replayed).plot._id).toBe(id);
    expect(await PlotModel.countDocuments({ _id: id })).toBe(1);
  });

  it('accepts the UUID in any case and resolves both to one row', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();

    const lower = await authed('put', token, `/${id}`).send(FULL_PLOT);
    const upper = await authed('put', token, `/${id.toUpperCase()}`).send(FULL_PLOT);

    expect(lower.status).toBe(201);
    expect(upper.status).toBe(200);
    expect(body<PlotBody>(upper).plot._id).toBe(id);
    expect(await PlotModel.countDocuments({})).toBe(1);
  });

  it('derives the centroid from the boundary when the client sends none', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    const plot = body<PlotBody>(await authed('get', token, `/${id}`)).plot;

    expect(plot.centroid.type).toBe('Point');
    // The centre of the square in `BOUNDARY`, longitude first.
    expect(plot.centroid.coordinates[0]).toBeCloseTo(80.401, 6);
    expect(plot.centroid.coordinates[1]).toBeCloseTo(8.301, 6);
  });

  it('accepts a centroid with no boundary, and rejects neither', async () => {
    const { token } = await seedFarmer();

    const pinned = await authed('put', token, `/${randomUUID()}`).send({
      name: 'Home garden',
      crop: 'CHILLI',
      areaAcres: 0.25,
      centroid: { type: 'Point', coordinates: [80.41, 8.31] },
    });
    expect(pinned.status).toBe(201);

    const unplaceable = await authed('put', token, `/${randomUUID()}`).send({
      name: 'Nowhere',
      crop: 'CHILLI',
      areaAcres: 0.25,
    });
    expect(unplaceable.status).toBe(422);
  });

  it('replaces rather than merges — omitted optional fields are cleared', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    const replaced = await authed('put', token, `/${id}`).send({
      name: 'Upper field',
      crop: 'PADDY',
      areaAcres: 2.5,
      centroid: { type: 'Point', coordinates: [80.401, 8.301] },
    });

    expect(replaced.status).toBe(200);
    const plot = body<PlotBody>(replaced).plot;
    expect(plot.boundary).toBeUndefined();
    expect(plot.notes).toBeNull();
    expect(plot.plantedAt).toBeNull();
  });

  it('ignores a userId in the body', async () => {
    const owner = await seedFarmer();
    const intruder = await seedFarmer();
    const id = randomUUID();

    const response = await authed('put', owner.token, `/${id}`).send({
      ...FULL_PLOT,
      userId: intruder.farmer._id.toString(),
    });

    expect(response.status).toBe(201);
    const stored = await PlotModel.findById(id).lean<Plot>().exec();
    expect(stored?.userId.toString()).toBe(owner.farmer._id.toString());
  });

  it('rejects a malformed id, and a UUID that is not v4', async () => {
    const { token } = await seedFarmer();

    expect((await authed('put', token, '/not-a-uuid').send(FULL_PLOT)).status).toBe(422);
    // A valid v1 UUID: version nibble 1, which encodes a MAC and a timestamp.
    const v1 = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';
    expect((await authed('put', token, `/${v1}`).send(FULL_PLOT)).status).toBe(422);
  });
});

describe('polygon validation', () => {
  it('rejects a ring whose last position does not repeat the first with 422', async () => {
    const { token } = await seedFarmer();

    const response = await authed('put', token, `/${randomUUID()}`).send({
      ...FULL_PLOT,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [80.4, 8.3],
            [80.402, 8.3],
            [80.402, 8.302],
            [80.4, 8.302],
          ],
        ],
      },
    });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a ring with fewer than four positions', async () => {
    const { token } = await seedFarmer();

    const response = await authed('put', token, `/${randomUUID()}`).send({
      ...FULL_PLOT,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [80.4, 8.3],
            [80.402, 8.3],
            [80.4, 8.3],
          ],
        ],
      },
    });

    expect(response.status).toBe(422);
  });

  it('rejects coordinates outside the lat/lng bounds', async () => {
    const { token } = await seedFarmer();

    const response = await authed('put', token, `/${randomUUID()}`).send({
      ...FULL_PLOT,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [200, 8.3],
            [80.402, 8.3],
            [80.402, 8.302],
            [200, 8.3],
          ],
        ],
      },
    });

    expect(response.status).toBe(422);
  });
});

describe('ownership', () => {
  it("answers 404, not 403, on another farmer's plot", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    const id = await createPlot(b.token);

    const read = await authed('get', a.token, `/${id}`);
    expect(read.status).toBe(404);
    expect(body<ErrorBody>(read).error.code).toBe('PLOT_NOT_FOUND');

    expect((await authed('patch', a.token, `/${id}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await authed('delete', a.token, `/${id}`)).status).toBe(404);

    // And none of those attempts touched it.
    const stored = await PlotModel.findById(id).lean<Plot>().exec();
    expect(stored?.name).toBe('Upper field');
    expect(stored?.deletedAt).toBeNull();
    expect(stored?.userId.toString()).toBe(b.farmer._id.toString());
  });

  it("refuses to overwrite another farmer's plot through PUT", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    const id = await createPlot(b.token);

    const response = await authed('put', a.token, `/${id}`).send({
      ...FULL_PLOT,
      name: 'Taken over',
    });

    // 404 rather than 409: a conflict would confirm the UUID is in use.
    expect(response.status).toBe(404);
    expect(await PlotModel.countDocuments({})).toBe(1);
    expect((await PlotModel.findById(id).lean<Plot>().exec())?.name).toBe('Upper field');
  });

  it("never lists another farmer's plots", async () => {
    const a = await seedFarmer();
    const b = await seedFarmer();
    await createPlot(b.token);
    const mine = await createPlot(a.token);

    const response = await authed('get', a.token);

    expect(response.status).toBe(200);
    expect(body<PlotListBody>(response).plots.map((plot) => plot._id)).toEqual([mine]);
  });

  it('requires a token, and the farmer role', async () => {
    expect((await request(app).get('/api/v1/plots')).status).toBe(401);

    const officer = await seedFarmer('officer');
    expect((await authed('get', officer.token)).status).toBe(403);
  });
});

describe('PATCH /plots/:id', () => {
  it('merges the given fields and leaves the rest alone', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    const response = await authed('patch', token, `/${id}`).send({ name: 'Lower field' });

    expect(response.status).toBe(200);
    const plot = body<PlotBody>(response).plot;
    expect(plot.name).toBe('Lower field');
    expect(plot.crop).toBe('PADDY');
    expect(plot.notes).toBe(FULL_PLOT.notes);
    expect(plot.boundary).toBeDefined();
  });

  it('moves the centroid when the boundary is redrawn', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    const response = await authed('patch', token, `/${id}`).send({
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [81.0, 7.0],
            [81.002, 7.0],
            [81.002, 7.002],
            [81.0, 7.002],
            [81.0, 7.0],
          ],
        ],
      },
    });

    expect(response.status).toBe(200);
    expect(body<PlotBody>(response).plot.centroid.coordinates[0]).toBeCloseTo(81.001, 6);
    expect(body<PlotBody>(response).plot.centroid.coordinates[1]).toBeCloseTo(7.001, 6);
  });

  it('answers 404 for a plot that was never created', async () => {
    const { token } = await seedFarmer();

    const response = await authed('patch', token, `/${randomUUID()}`).send({ name: 'Ghost' });
    expect(response.status).toBe(404);
  });
});

describe('version', () => {
  it('increments on every write, including the delete', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    expect(body<PlotBody>(await authed('get', token, `/${id}`)).plot.version).toBe(1);

    const patched = await authed('patch', token, `/${id}`).send({ name: 'Second' });
    expect(body<PlotBody>(patched).plot.version).toBe(2);

    const replaced = await authed('put', token, `/${id}`).send({ ...FULL_PLOT, name: 'Third' });
    expect(body<PlotBody>(replaced).plot.version).toBe(3);

    await authed('delete', token, `/${id}`);
    // The tombstone is the newest version, which is how a late-syncing device
    // learns that the delete happened at all.
    expect((await PlotModel.findById(id).lean<Plot>().exec())?.version).toBe(4);
  });
});

describe('DELETE /plots/:id', () => {
  it('soft deletes with 204, keeps the row, and drops it from the list', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    const deleted = await authed('delete', token, `/${id}`);
    expect(deleted.status).toBe(204);

    const stored = await PlotModel.findById(id).lean<Plot>().exec();
    expect(stored).not.toBeNull();
    expect(stored?.deletedAt).toBeInstanceOf(Date);

    expect(body<PlotListBody>(await authed('get', token)).plots).toEqual([]);
    expect((await authed('get', token, `/${id}`)).status).toBe(404);
  });

  it('keeps the UUID reserved — a replayed create does not resurrect it', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);
    await authed('delete', token, `/${id}`);

    const replayed = await authed('put', token, `/${id}`).send(FULL_PLOT);

    expect(replayed.status).toBe(404);
    expect(await PlotModel.countDocuments({})).toBe(1);
    expect((await PlotModel.findById(id).lean<Plot>().exec())?.deletedAt).toBeInstanceOf(Date);
  });

  it('is not repeatable — a second delete is a 404', async () => {
    const { token } = await seedFarmer();
    const id = await createPlot(token);

    expect((await authed('delete', token, `/${id}`)).status).toBe(204);
    expect((await authed('delete', token, `/${id}`)).status).toBe(404);
  });
});

describe('GET /plots — cursor pagination', () => {
  it('walks every plot exactly once, newest first', async () => {
    const { token } = await seedFarmer();
    const ids: string[] = [];
    for (const name of ['one', 'two', 'three', 'four', 'five']) {
      ids.push(await createPlot(token, { name }));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const path: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const response = await authed('get', token, path);
      expect(response.status).toBe(200);

      const page = body<PlotListBody>(response);
      expect(page.plots.length).toBeLessThanOrEqual(2);
      seen.push(...page.plots.map((plot) => plot._id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    // `updatedAt` descending: the last plot created is the first one served.
    expect(seen).toEqual([...ids].reverse());
  });

  it('never serves a row twice when a row already seen is edited mid-walk', async () => {
    const { token } = await seedFarmer();
    for (const name of ['one', 'two', 'three', 'four']) {
      await createPlot(token, { name });
    }

    const first = body<PlotListBody>(await authed('get', token, '?limit=2'));
    expect(first.plots).toHaveLength(2);

    // Touching an already-served plot moves it back to the head of the order.
    // Offset paging would push an unseen row across the boundary and serve it
    // twice; the cursor names a position in the ordering, so it cannot.
    const alreadySeen = first.plots[0];
    expect(alreadySeen).toBeDefined();
    await authed('patch', token, `/${alreadySeen?._id ?? ''}`).send({ name: 'edited' });

    const second = body<PlotListBody>(
      await authed('get', token, `?limit=2&cursor=${first.nextCursor ?? ''}`),
    );

    const ids = [...first.plots, ...second.plots].map((plot) => plot._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('breaks ties on _id when several plots share an updatedAt', async () => {
    const { token } = await seedFarmer();
    const ids = [await createPlot(token), await createPlot(token), await createPlot(token)];

    // Forced onto one instant with `timestamps: false`, so the write does not
    // immediately undo itself. Three HTTP calls land in three different
    // milliseconds and would prove nothing about the tie-break.
    await PlotModel.updateMany(
      {},
      { $set: { updatedAt: new Date('2026-09-01T10:00:00.000Z') } },
      { timestamps: false },
    ).exec();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const path: string = cursor === null ? '?limit=1' : `?limit=1&cursor=${cursor}`;
      const page = body<PlotListBody>(await authed('get', token, path));
      seen.push(...page.plots.map((plot) => plot._id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('rejects a cursor it did not issue, and an out-of-range limit', async () => {
    const { token } = await seedFarmer();

    expect((await authed('get', token, '?cursor=not-a-cursor')).status).toBe(422);
    expect((await authed('get', token, '?limit=0')).status).toBe(422);
    expect((await authed('get', token, '?limit=500')).status).toBe(422);
  });
});

describe('indexes', () => {
  it('has the 2dsphere and the owner/live/recent compound index', async () => {
    const indexes = await PlotModel.collection.indexes();
    const byName = new Map(indexes.map((index) => [index.name, index.key]));

    expect(byName.get('centroid_2dsphere')).toEqual({ centroid: '2dsphere' });
    expect(byName.get('owner_live_recent')).toEqual({ userId: 1, deletedAt: 1, updatedAt: -1 });
  });
});
