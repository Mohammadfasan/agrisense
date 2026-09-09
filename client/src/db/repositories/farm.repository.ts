import { v4 as uuidv4 } from 'uuid';

import { db, type Farm } from '../schema';
import { outboxRepository } from './outbox.repository';

/**
 * Writes land locally first and are queued for sync — the UI never waits on the
 * network to show the user their own edit.
 */
export const farmRepository = {
  list(): Promise<Farm[]> {
    return db.farms.orderBy('updatedAt').reverse().toArray();
  },

  get(id: string): Promise<Farm | undefined> {
    return db.farms.get(id);
  },

  async create(input: Omit<Farm, 'id' | 'updatedAt'>): Promise<Farm> {
    const farm: Farm = { ...input, id: uuidv4(), updatedAt: Date.now() };
    await db.transaction('rw', db.farms, db.outbox, async () => {
      await db.farms.add(farm);
      await outboxRepository.enqueue('farms', farm.id, 'create', farm);
    });
    return farm;
  },

  async update(id: string, changes: Partial<Omit<Farm, 'id'>>): Promise<void> {
    const patch = { ...changes, updatedAt: Date.now() };
    await db.transaction('rw', db.farms, db.outbox, async () => {
      await db.farms.update(id, patch);
      await outboxRepository.enqueue('farms', id, 'update', patch);
    });
  },

  async remove(id: string): Promise<void> {
    await db.transaction('rw', db.farms, db.outbox, async () => {
      await db.farms.delete(id);
      await outboxRepository.enqueue('farms', id, 'delete', { id });
    });
  },
};
