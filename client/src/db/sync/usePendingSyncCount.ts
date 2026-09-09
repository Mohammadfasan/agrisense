import { useLiveQuery } from 'dexie-react-hooks';

import { outboxRepository } from '../repositories/outbox.repository';

/** Live count of queued writes; re-renders whenever the outbox changes. */
export function usePendingSyncCount(): number {
  return useLiveQuery(() => outboxRepository.countPending(), [], 0);
}
