import { v4 as uuidv4 } from 'uuid';

import { db, type OutboxEntry, type OutboxOperation } from '../schema';

/** The queue of local writes that still have to reach the server. */
export const outboxRepository = {
  async enqueue(
    table: OutboxEntry['table'],
    entityId: string,
    operation: OutboxOperation,
    payload: unknown,
  ): Promise<string> {
    const id = uuidv4();
    await db.outbox.add({
      id,
      table,
      entityId,
      operation,
      payload,
      status: 'pending',
      attempts: 0,
      lastError: null,
      queuedAt: Date.now(),
    });
    return id;
  },

  pending(): Promise<OutboxEntry[]> {
    return db.outbox.where('status').equals('pending').sortBy('queuedAt');
  },

  countPending(): Promise<number> {
    return db.outbox.where('status').equals('pending').count();
  },

  async markFailed(id: string, error: string): Promise<void> {
    const entry = await db.outbox.get(id);
    if (!entry) {
      return;
    }
    await db.outbox.update(id, {
      status: 'failed',
      attempts: entry.attempts + 1,
      lastError: error,
    });
  },

  async retryFailed(): Promise<void> {
    await db.outbox.where('status').equals('failed').modify({ status: 'pending' });
  },

  async remove(id: string): Promise<void> {
    await db.outbox.delete(id);
  },
};
