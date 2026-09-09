import { v4 as uuidv4 } from 'uuid';

import { db, type Scan } from '../schema';
import { outboxRepository } from './outbox.repository';

export const scanRepository = {
  listByFarm(farmId: string): Promise<Scan[]> {
    return db.scans.where('farmId').equals(farmId).reverse().sortBy('capturedAt');
  },

  get(id: string): Promise<Scan | undefined> {
    return db.scans.get(id);
  },

  async create(input: Omit<Scan, 'id' | 'capturedAt' | 'syncedAt'>): Promise<Scan> {
    const scan: Scan = { ...input, id: uuidv4(), capturedAt: Date.now(), syncedAt: null };
    await db.transaction('rw', db.scans, db.outbox, async () => {
      await db.scans.add(scan);
      // The image blob is uploaded separately; the outbox carries metadata only.
      await outboxRepository.enqueue('scans', scan.id, 'create', {
        id: scan.id,
        farmId: scan.farmId,
        cropType: scan.cropType,
        capturedAt: scan.capturedAt,
      });
    });
    return scan;
  },

  async markSynced(id: string, diagnosis: string, confidence: number): Promise<void> {
    await db.scans.update(id, { diagnosis, confidence, syncedAt: Date.now() });
  },
};
