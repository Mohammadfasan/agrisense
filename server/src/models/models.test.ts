import { describe, expect, it } from 'vitest';

import { env } from '@config';

import { FarmerModel } from './farmer.model';
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
