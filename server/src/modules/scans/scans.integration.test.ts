import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlotModel, ScanModel, type Scan } from '@models';

import { createApp } from '../../app';
import { seedFarmer } from '../../test/actors';
import { body } from '../../test/http';

import type { MlResult } from './mlClient';
import type * as PhotoStorageModule from './photoStorage';
import type { FarmerScanView } from './scan.presenter';

/**
 * End-to-end coverage of `/scans` through the real app and a real MongoDB.
 *
 * Only the two edges of the system are replaced:
 *   - ml-service: each test says what the "model" answers next (`fake.next`)
 *     and can count how often it was asked (`fake.calls`);
 *   - photo storage: the real `LocalPhotoStorage`, on a temporary directory.
 * Auth, multer, validation, the service, the database and the farmer view
 * are all the production code.
 */

const fake = vi.hoisted(() => ({
  next: null as MlResult | null,
  calls: 0,
  uploadDir: '',
}));

vi.mock('./mlClient', () => ({
  createMlClient: () => ({
    diagnose: () => {
      fake.calls += 1;
      return Promise.resolve(fake.next);
    },
  }),
}));

vi.mock('./photoStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof PhotoStorageModule>();
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const nodePath = await import('node:path');
  fake.uploadDir = mkdtempSync(nodePath.join(tmpdir(), 'agrisense-scans-'));
  return {
    ...actual,
    LocalPhotoStorage: class extends actual.LocalPhotoStorage {
      constructor() {
        super(fake.uploadDir);
      }
    },
  };
});

const app = createApp();

interface ScanBody {
  scan: FarmerScanView;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a leaf')]);
const OTHER_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('another')]);

function decision(
  status: 'diagnosed' | 'escalated',
  classKey = 'maize_common_rust',
  isHealthy = false,
): MlResult {
  return {
    kind: 'decision',
    status,
    diagnosis: {
      classKey,
      isHealthy,
      confidence: status === 'diagnosed' ? 0.97 : 0.62,
      requiredConfidence: isHealthy ? 0.9 : 0.7,
      top: [{ classKey, probability: status === 'diagnosed' ? 0.97 : 0.62 }],
      heatmap: isHealthy
        ? null
        : {
            grid: [
              [0, 1],
              [0.5, 0.2],
            ],
            region: [0.0625, 0.0625, 0.9375, 0.9375],
          },
      modelVersion: '1.0.0',
      inferenceMs: 9,
      diagnosedAt: new Date(),
    },
  };
}

function upload(
  token: string,
  id: string,
  photo: Buffer = JPEG,
  fields: Record<string, string> = {},
): request.Test {
  let req = request(app)
    .put(`/api/v1/scans/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .field('capturedAt', fields.capturedAt ?? new Date().toISOString());
  for (const [key, value] of Object.entries(fields)) {
    if (key !== 'capturedAt') {
      req = req.field(key, value);
    }
  }
  return req.attach('photo', photo, { filename: 'leaf.jpg', contentType: 'image/jpeg' });
}

function get(token: string, id: string): request.Test {
  return request(app).get(`/api/v1/scans/${id}`).set('Authorization', `Bearer ${token}`);
}

async function stored(id: string): Promise<Scan | null> {
  return ScanModel.findById(id).lean<Scan>().exec();
}

async function seedPlot(userId: string): Promise<string> {
  const id = randomUUID();
  await PlotModel.create({
    _id: id,
    userId,
    name: 'Upper field',
    crop: 'PADDY',
    areaAcres: 1,
    centroid: { type: 'Point', coordinates: [80.4, 8.3] },
  });
  return id;
}

beforeEach(() => {
  fake.next = decision('diagnosed');
  fake.calls = 0;
});

afterAll(() => {
  rmSync(fake.uploadDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */

describe('PUT /scans/:id — outcomes', () => {
  it('creates a confident scan with 201, stores the photo, and shows the diagnosis', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();

    const response = await upload(token, id);

    expect(response.status).toBe(201);
    const { scan } = body<ScanBody>(response);
    expect(scan._id).toBe(id);
    expect(scan.status).toBe('diagnosed');
    expect(scan.diagnosis?.classKey).toBe('maize_common_rust');
    expect(scan.diagnosis?.heatmap?.region).toEqual([0.0625, 0.0625, 0.9375, 0.9375]);

    const saved = await stored(id);
    expect(saved?.photo.sizeBytes).toBe(JPEG.length);
    expect(
      existsSync(path.join(fake.uploadDir, ...(saved?.photo.storageKey ?? '').split('/'))),
    ).toBe(true);
  });

  it('hides the class from the farmer when escalated, but keeps it for officers', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();
    fake.next = decision('escalated');

    const { scan } = body<ScanBody>(await upload(token, id));

    // The confidence ADR, enforced on the way out.
    expect(scan.status).toBe('escalated');
    expect(scan.diagnosis).toBeNull();
    // ...while the database still knows what the model thought.
    expect((await stored(id))?.diagnosis?.classKey).toBe('maize_common_rust');
  });

  it('records an unusable photo as rejected, with a reason safe to show', async () => {
    const { token } = await seedFarmer();
    fake.next = { kind: 'rejected', reason: 'the image is too small (50x40)' };

    const { scan } = body<ScanBody>(await upload(token, randomUUID()));

    expect(scan.status).toBe('rejected');
    expect(scan.rejectReason).toBe('the image is too small (50x40)');
    expect(scan.diagnosis).toBeNull();
  });

  it('keeps the scan pending when ml-service is down, and the replay retries it', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();
    fake.next = { kind: 'unavailable', error: 'ml-service unreachable' };

    const first = await upload(token, id);

    expect(first.status).toBe(201);
    expect(body<ScanBody>(first).scan.status).toBe('pending');
    const pending = await stored(id);
    expect(pending?.attempts).toBe(1);
    expect(pending?.lastError).toBe('ml-service unreachable');
    // Nothing the farmer can see changed, so nothing new to sync.
    expect(pending?.version).toBe(1);

    // ml-service is back; the offline queue replays the same upload.
    fake.next = decision('diagnosed');
    const replay = await upload(token, id);

    expect(replay.status).toBe(200);
    expect(body<ScanBody>(replay).scan.status).toBe('diagnosed');
    expect(body<ScanBody>(replay).scan.version).toBe(2);
    expect(fake.calls).toBe(2);
  });
});

describe('PUT /scans/:id — idempotency', () => {
  it('answers a replay with 200 and the same scan, without asking the model again', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();

    expect((await upload(token, id)).status).toBe(201);
    const replay = await upload(token, id);

    expect(replay.status).toBe(200);
    expect(body<ScanBody>(replay).scan.status).toBe('diagnosed');
    expect(fake.calls).toBe(1);
    expect(await ScanModel.countDocuments({ _id: id })).toBe(1);
  });

  it('refuses a different photo under an existing id with 409', async () => {
    const { token } = await seedFarmer();
    const id = randomUUID();
    await upload(token, id);

    const response = await upload(token, id, OTHER_JPEG);

    expect(response.status).toBe(409);
    expect(body<ErrorBody>(response).error.code).toBe('SCAN_CONFLICT');
    expect((await stored(id))?.photo.sizeBytes).toBe(JPEG.length);
  });
});

describe('PUT /scans/:id — plots and location', () => {
  it("copies the plot's crop, and uses its centroid when the phone sent no location", async () => {
    const { farmer, token } = await seedFarmer();
    const plotId = await seedPlot(farmer._id.toString());

    const response = await upload(token, randomUUID(), JPEG, { plotId });

    expect(response.status).toBe(201);
    expect(body<ScanBody>(response).scan.crop).toBe('PADDY');
    const saved = await stored(body<ScanBody>(response).scan._id);
    expect(saved?.location?.coordinates).toEqual([80.4, 8.3]);
  });

  it("prefers the phone's location over the plot's centroid", async () => {
    const { farmer, token } = await seedFarmer();
    const plotId = await seedPlot(farmer._id.toString());
    const id = randomUUID();

    await upload(token, id, JPEG, { plotId, longitude: '80.45', latitude: '8.35' });

    expect((await stored(id))?.location?.coordinates).toEqual([80.45, 8.35]);
  });

  it("answers 404 for another farmer's plot, and creates nothing", async () => {
    const owner = await seedFarmer();
    const intruder = await seedFarmer();
    const plotId = await seedPlot(owner.farmer._id.toString());

    const response = await upload(intruder.token, randomUUID(), JPEG, { plotId });

    expect(response.status).toBe(404);
    expect(body<ErrorBody>(response).error.code).toBe('PLOT_NOT_FOUND');
    expect(await ScanModel.countDocuments({})).toBe(0);
    expect(fake.calls).toBe(0);
  });
});

describe('ownership', () => {
  it("answers 404, not 403, on another farmer's scan — for reads and for writes", async () => {
    const owner = await seedFarmer();
    const intruder = await seedFarmer();
    const id = randomUUID();
    await upload(owner.token, id);

    const read = await get(intruder.token, id);
    expect(read.status).toBe(404);
    expect(body<ErrorBody>(read).error.code).toBe('SCAN_NOT_FOUND');

    const write = await upload(intruder.token, id, OTHER_JPEG);
    expect(write.status).toBe(404);

    // Untouched, and the model was only ever asked about the owner's upload.
    expect((await stored(id))?.userId.toString()).toBe(owner.farmer._id.toString());
    expect((await stored(id))?.photo.sizeBytes).toBe(JPEG.length);
    expect(fake.calls).toBe(1);
  });

  it('requires a token', async () => {
    const response = await request(app)
      .put(`/api/v1/scans/${randomUUID()}`)
      .field('capturedAt', new Date().toISOString())
      .attach('photo', JPEG, { filename: 'leaf.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(401);
  });
});

describe('validation', () => {
  it('rejects bytes that are not a photo, whatever they are called, and stores nothing', async () => {
    const { token } = await seedFarmer();

    const response = await upload(token, randomUUID(), Buffer.from('%PDF-1.7 not a leaf'));

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('SCAN_IMAGE_INVALID');
    expect(await ScanModel.countDocuments({})).toBe(0);
    expect(fake.calls).toBe(0);
  });

  it('requires the photo', async () => {
    const { token } = await seedFarmer();

    const response = await request(app)
      .put(`/api/v1/scans/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .field('capturedAt', new Date().toISOString());

    expect(response.status).toBe(422);
  });

  it('rejects a malformed id, a future capture time, and half a location', async () => {
    const { token } = await seedFarmer();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    expect((await upload(token, 'not-a-uuid')).status).toBe(422);
    expect((await upload(token, randomUUID(), JPEG, { capturedAt: tomorrow })).status).toBe(422);
    expect((await upload(token, randomUUID(), JPEG, { latitude: '8.3' })).status).toBe(422);
    expect(fake.calls).toBe(0);
  });

  it('answers 413 for a photo over the size limit', async () => {
    const { token } = await seedFarmer();
    const huge = Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]);

    const response = await upload(token, randomUUID(), huge);

    expect(response.status).toBe(413);
    expect(body<ErrorBody>(response).error.code).toBe('SCAN_PHOTO_TOO_LARGE');
  });
});

describe('indexes', () => {
  it('has the owner, pending-queue and 2dsphere indexes', async () => {
    const indexes = await ScanModel.collection.indexes();
    const byName = new Map(indexes.map((index) => [index.name, index]));

    expect(byName.get('owner_live_recent')?.key).toEqual({
      userId: 1,
      deletedAt: 1,
      createdAt: -1,
    });
    expect(byName.get('pending_queue')?.partialFilterExpression).toEqual({ status: 'pending' });
    expect(byName.get('location_2dsphere')?.key).toEqual({ location: '2dsphere' });
  });
});
