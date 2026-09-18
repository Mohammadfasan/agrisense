import mongoose, { type ClientSession } from 'mongoose';

import { logger } from '@config';

/**
 * Runs a unit of work in a MongoDB transaction, where the deployment has them.
 *
 * **Why a transaction at all.** Calendar regeneration is a delete followed by
 * an insert. Between the two the farmer's plot has no calendar, and if the
 * process dies there it stays that way — the previous plan tombstoned and the
 * new one never written. That is a farmer opening the app to an empty season.
 * Both halves go in one atomic unit so there is no point at which a calendar
 * has been taken away and not given back.
 *
 * **Why there is a fallback.** Transactions need a replica set or a mongos;
 * a standalone `mongod` refuses them outright. This repo's `docker-compose.yml`
 * runs a standalone, and `docs/schema.md` has said since Day 11 that the
 * project takes no dependency on a replica set. Requiring one here would mean
 * every `POST .../calendar/generate` returning a 500 on a developer's machine
 * and in the demo environment, which is a worse failure than the one the
 * transaction prevents.
 *
 * So: use a transaction when the server offers one, and run the same callback
 * unwrapped when it does not, having said so in the log exactly once. The
 * exposure in the fallback is the interleaving above, and it is why the delete
 * in `calendarGeneration.service` is scoped as tightly as it is — the worst
 * case there is a plan a farmer can rebuild by pressing the button again, not
 * lost work.
 *
 * To get the real thing in development, start mongo as a single-node replica
 * set (`--replSet rs0` plus one `rs.initiate()`); the tests already do, via
 * `MongoMemoryReplSet` in `src/test/mongo.setup.ts`, so the transactional path
 * is the one under test.
 */

/** Logged once per process, not once per request. */
let warnedAboutStandalone = false;

/**
 * MongoDB's answer when a standalone is asked to start a transaction.
 *
 * Matched on the code and the label rather than the message text, which is not
 * a stable interface. 20 is `IllegalOperation`; the `TransientTransactionError`
 * label is absent here precisely because retrying would not help.
 */
function isTransactionsUnsupported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

  return (
    code === 20 ||
    code === 263 ||
    message.includes('Transaction numbers are only allowed on') ||
    message.includes('Transactions are not supported')
  );
}

/**
 * Runs `work` inside a transaction, or directly if the deployment has none.
 *
 * The callback receives the session and **must pass it to every operation it
 * performs** — a write without it runs outside the transaction and will not be
 * rolled back. When there is no transaction the session is `undefined`, which
 * every Mongoose query accepts as "no session", so the callback is written
 * once and works both ways.
 */
export async function withTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  let session: ClientSession | undefined;

  try {
    session = await mongoose.startSession();
  } catch (error) {
    if (!isTransactionsUnsupported(error)) {
      throw error;
    }
    warnOnce();
    return work(undefined);
  }

  try {
    let result: T | undefined;
    // `withTransaction` rather than a hand-rolled start/commit/abort: it is
    // what retries a `TransientTransactionError`, which a replica set election
    // can raise on a perfectly correct transaction.
    await session.withTransaction(async () => {
      result = await work(session);
    });
    // `withTransaction` resolving means the callback ran and committed, so the
    // assignment above happened. The cast is confined to this one line.
    return result as T;
  } catch (error) {
    if (!isTransactionsUnsupported(error)) {
      throw error;
    }
    warnOnce();
    return await work(undefined);
  } finally {
    await session.endSession();
  }
}

function warnOnce(): void {
  if (warnedAboutStandalone) {
    return;
  }
  warnedAboutStandalone = true;
  logger.warn(
    'MongoDB has no transaction support here (standalone mongod); ' +
      'calendar generation will run its delete and insert unwrapped. ' +
      'Start mongo as a single-node replica set to restore atomicity.',
  );
}

/** Test seam: lets a test assert the warning fires, without a shared process. */
export function resetTransactionWarningForTests(): void {
  warnedAboutStandalone = false;
}
