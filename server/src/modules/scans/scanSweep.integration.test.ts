import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ScanModel, type Scan } from '@models';

import { seedFarmer } from '../../test/actors';

import type { DiagnosisClient, MlResult } from './mlClient';
import { LocalPhotoStorage } from './photoStorage';
import { RETRY } from './retryPolicy';
import { createScanService, type ScanService } from './scan.service';

/**
 * The retry sweep against a real MongoDB, with a controllable clock and a
 * fake ml-service. The things that matter here are about TIME (backoff,
 * lease expiry) and CONCURRENCY (two workers, one scan), so the tests move
 * the clock instead of waiting, and run sweeps side by side.
 */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a leaf')]);
const UNAVAILABLE: MlResult = { kind: 'unavailable', error: 'ml-service unreachable' };

const uploadDir = mkdtempSync(path.join(os.tmpdir(), 'agrisense-sweep-'));

afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

function diagnosed(): MlResult {
  return {
    kind: 'decision',
    status: 'diagnosed',
    diagnosis: {
      classKey: 'maize_common_rust',
      isHealthy: false,
      confidence: 0.97,
      requiredConfidence: 0.7,
      top: [{ classKey: 'maize_common_rust', probability: 0.97 }],
      heatmap: null,
      modelVersion: '1.0.0',
      inferenceMs: 9,
      diagnosedAt: new Date(),
    },
  };
}

/** A clock the test moves by hand. */
function makeClock(start = '2026-09-27T10:00:00.000Z') {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A fake ml-service: answers `state.next`, counts `state.calls`. */
function makeMl() {
  const state = { next: UNAVAILABLE, calls: 0 };
  const client: DiagnosisClient = {
    diagnose: () => {
      state.calls += 1;
      return Promise.resolve(state.next);
    },
  };
  return { state, client };
}

let clock: ReturnType<typeof makeClock>;
let ml: ReturnType<typeof makeMl>;
let service: ScanService;
let userId: string;

beforeEach(async () => {
  clock = makeClock();
  ml = makeMl();
  service = createScanService({
    storage: new LocalPhotoStorage(uploadDir),
    ml: ml.client,
    now: clock.now,
  });
  userId = (await seedFarmer()).farmer._id.toString();
});

/** Uploads a scan while ml-service is down, so it ends up pending. */
async function pendingScan(): Promise<string> {
  const id = randomUUID();
  ml.state.next = UNAVAILABLE;
  const { scan } = await service.save(userId, id, {
    plotId: null,
    capturedAt: clock.now(),
    photo: JPEG,
  });
  expect(scan.status).toBe('pending');
  return id;
}

async function stored(id: string): Promise<Scan | null> {
  return ScanModel.findById(id).lean<Scan>().exec();
}

/* -------------------------------------------------------------------------- */

describe('runDueDiagnoses', () => {
  it('leaves a scan alone until its retry is due', async () => {
    await pendingScan();

    // The first retry is ~30 s after the failed upload (24–36 s with jitter).
    expect((await service.runDueDiagnoses()).claimed).toBe(0);

    clock.advance(40_000);
    ml.state.next = diagnosed();
    expect((await service.runDueDiagnoses()).claimed).toBe(1);
  });

  it('diagnoses a due scan once ml-service is back, reading the photo from storage', async () => {
    const id = await pendingScan();
    clock.advance(40_000);
    ml.state.next = diagnosed();

    const result = await service.runDueDiagnoses();

    expect(result).toEqual({ claimed: 1, decided: 1, deferred: 0 });
    const scan = await stored(id);
    expect(scan?.status).toBe('diagnosed');
    expect(scan?.nextAttemptAt).toBeNull();
    expect(scan?.version).toBe(2);
    expect(scan?.lastError).toBeNull();
  });

  it('backs off: the second failure waits about a minute, not thirty seconds', async () => {
    const id = await pendingScan();
    clock.advance(40_000);

    const result = await service.runDueDiagnoses();

    expect(result).toEqual({ claimed: 1, decided: 0, deferred: 1 });
    const scan = await stored(id);
    expect(scan?.attempts).toBe(2);
    const waitMs = (scan?.nextAttemptAt?.getTime() ?? 0) - clock.now().getTime();
    // 60 s ± 20%.
    expect(waitMs).toBeGreaterThanOrEqual(48_000);
    expect(waitMs).toBeLessThanOrEqual(72_000);
  });

  it('never lets two workers take the same scan', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => pendingScan()));
    clock.advance(40_000);
    ml.state.next = diagnosed();
    ml.state.calls = 0;

    const second = createScanService({
      storage: new LocalPhotoStorage(uploadDir),
      ml: ml.client,
      now: clock.now,
    });
    const [a, b] = await Promise.all([service.runDueDiagnoses(), second.runDueDiagnoses()]);

    // Five scans, five claims between them, five model calls: none twice.
    expect(a.claimed + b.claimed).toBe(5);
    expect(ml.state.calls).toBe(5);
    for (const id of ids) {
      expect((await stored(id))?.status).toBe('diagnosed');
    }
  });

  it("gives a crashed worker's scan back when its lease runs out", async () => {
    await pendingScan();
    clock.advance(40_000);

    // A worker claims the scan and dies before diagnosing it.
    expect(await service.claimDue()).not.toBeNull();

    ml.state.next = diagnosed();
    expect((await service.runDueDiagnoses()).claimed).toBe(0);

    clock.advance(RETRY.leaseMs + 1_000);
    expect((await service.runDueDiagnoses()).decided).toBe(1);
  });

  it('stops retrying after the last attempt', async () => {
    const id = await pendingScan();
    await ScanModel.updateOne(
      { _id: id },
      { $set: { attempts: RETRY.maxAttempts - 1, nextAttemptAt: clock.now() } },
    ).exec();

    await service.runDueDiagnoses();

    const scan = await stored(id);
    expect(scan?.attempts).toBe(RETRY.maxAttempts);
    expect(scan?.nextAttemptAt).toBeNull();
    expect(scan?.status).toBe('pending');

    clock.advance(7 * 24 * 60 * 60 * 1000);
    expect((await service.runDueDiagnoses()).claimed).toBe(0);
  });

  it('skips deleted scans', async () => {
    const id = await pendingScan();
    await ScanModel.updateOne({ _id: id }, { $set: { deletedAt: new Date() } }).exec();
    clock.advance(40_000);

    expect((await service.runDueDiagnoses()).claimed).toBe(0);
  });

  it('takes at most `limit` scans in one sweep', async () => {
    await Promise.all([1, 2, 3].map(() => pendingScan()));
    clock.advance(40_000);
    ml.state.next = diagnosed();

    expect((await service.runDueDiagnoses(2)).claimed).toBe(2);
    expect((await service.runDueDiagnoses(2)).claimed).toBe(1);
  });
});
