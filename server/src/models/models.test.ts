import { describe, expect, it } from 'vitest';

import { env } from '@config';

import { CalendarTaskModel } from './calendarTask.model';
import { FarmerModel } from './farmer.model';
import { FarmerProfileModel } from './farmerProfile.model';
import { OtpModel } from './otp.model';
import { RefreshTokenModel } from './refreshToken.model';

/**
 * Asserts that the indexes in `docs/schema.md` are the indexes MongoDB
 * actually holds.
 *
 * A missing index is invisible in every other test — the queries still return
 * the right answers, just slowly, and a missing *unique* index returns wrong
 * answers only under a race. Reading them back off the live collection is the
 * only check that catches a schema declaration that never made it to the
 * server.
 */

interface IndexSpec {
  key: Record<string, unknown>;
  unique?: boolean;
  expireAfterSeconds?: number;
}

/** Reads the index specs straight off the live collection. */
async function indexesOf(collection: { indexes(): Promise<unknown[]> }): Promise<IndexSpec[]> {
  return (await collection.indexes()) as IndexSpec[];
}

function find(indexes: IndexSpec[], key: Record<string, unknown>): IndexSpec | undefined {
  return indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
}

describe('farmers indexes', () => {
  it('matches docs/schema.md §1', async () => {
    const indexes = await indexesOf(FarmerModel.collection);

    expect(find(indexes, { phone: 1 })?.unique).toBe(true);
    expect(find(indexes, { role: 1, district: 1 })).toBeDefined();
    expect(find(indexes, { district: 1, isActive: 1 })).toBeDefined();
  });
});

describe('farmerProfiles indexes', () => {
  it('holds one profile per farmer and a 2dsphere on the location', async () => {
    const indexes = await indexesOf(FarmerProfileModel.collection);

    // "One profile per farmer" is enforced here and nowhere else: the upsert
    // in `farmerProfile.service` relies on it to make two concurrent PUTs
    // collide rather than both insert.
    expect(find(indexes, { userId: 1 })?.unique).toBe(true);

    // Week 9 outbreak clustering (DBSCAN) scans profiles by proximity, which
    // MongoDB refuses outright without this -- unlike a missing plain index,
    // it fails loudly, but only once the feature exists to fail.
    expect(find(indexes, { location: '2dsphere' })).toBeDefined();
    expect(find(indexes, { district: 1 })).toBeDefined();
  });
});

describe('otps indexes', () => {
  it('matches docs/schema.md §2', async () => {
    const indexes = await indexesOf(OtpModel.collection);

    expect(find(indexes, { phone: 1, purpose: 1 })).toBeDefined();

    // TTL purge. The grace over `expiresAt` is deliberate: the row has to
    // outlive the code it carries for per-phone rate limiting to be able to
    // count it. See the comment on the index in `otp.model.ts`.
    const ttl = find(indexes, { expiresAt: 1 });
    expect(ttl?.expireAfterSeconds).toBe(env.OTP_REQUEST_WINDOW_SECONDS);
  });
});

describe('refreshTokens indexes', () => {
  it('matches docs/schema.md §3', async () => {
    const indexes = await indexesOf(RefreshTokenModel.collection);

    // Reuse detection looks a token up by hash on every refresh; unique is
    // what makes that lookup a single unambiguous row.
    expect(find(indexes, { tokenHash: 1 })?.unique).toBe(true);
    expect(find(indexes, { farmerId: 1, familyId: 1 })).toBeDefined();
    expect(find(indexes, { expiresAt: 1 })?.expireAfterSeconds).toBe(0);
  });
});

describe('calendarTasks indexes', () => {
  it('matches docs/schema.md §19', async () => {
    const indexes = await indexesOf(CalendarTaskModel.collection);

    // One plot's calendar: the month and week views, which always name a plot.
    expect(find(indexes, { userId: 1, plotId: 1, deletedAt: 1, dueDate: 1 })).toBeDefined();

    // `/calendar/upcoming`, which names no plot. The index above cannot serve
    // it -- `plotId` sits in the middle of it, so an unconstrained query can
    // only use `userId` as a prefix and would sort every task the farmer owns
    // in memory.
    expect(find(indexes, { userId: 1, deletedAt: 1, dueDate: 1 })).toBeDefined();
  });
});
