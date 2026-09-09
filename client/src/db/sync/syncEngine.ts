import { api } from '@/shared/api/client';

import { outboxRepository } from '../repositories/outbox.repository';
import type { OutboxEntry } from '../schema';

const ENDPOINTS: Record<OutboxEntry['table'], string> = {
  farms: '/farms',
  scans: '/scans',
};

let running = false;

/**
 * Drains the outbox oldest-first, stopping at the first failure so writes are
 * never applied out of order. Safe to call repeatedly: a second call while one
 * is in flight is a no-op.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (running || !navigator.onLine) {
    return { sent: 0, failed: 0 };
  }
  running = true;

  let sent = 0;
  let failed = 0;

  try {
    const entries = await outboxRepository.pending();

    for (const entry of entries) {
      try {
        await send(entry);
        await outboxRepository.remove(entry.id);
        sent += 1;
      } catch (error) {
        await outboxRepository.markFailed(
          entry.id,
          error instanceof Error ? error.message : String(error),
        );
        failed += 1;
        // Preserve ordering: a later write may depend on this one.
        break;
      }
    }
  } finally {
    running = false;
  }

  return { sent, failed };
}

async function send(entry: OutboxEntry): Promise<void> {
  const base = ENDPOINTS[entry.table];

  switch (entry.operation) {
    case 'create':
      await api.post(base, entry.payload);
      return;
    case 'update':
      await api.patch(`${base}/${entry.entityId}`, entry.payload);
      return;
    case 'delete':
      await api.delete(`${base}/${entry.entityId}`);
      return;
  }
}

/** Flushes on reconnect and on a slow interval while the tab is open. */
export function startSyncLoop(intervalMs = 30_000): () => void {
  const flush = (): void => {
    void flushOutbox();
  };

  window.addEventListener('online', flush);
  const timer = window.setInterval(flush, intervalMs);
  flush();

  return () => {
    window.removeEventListener('online', flush);
    window.clearInterval(timer);
  };
}
