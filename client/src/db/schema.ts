import Dexie, { type EntityTable } from 'dexie';

/**
 * Records created on the device carry a client-generated UUID as their primary
 * key, so a row can be written, referenced and displayed long before the server
 * has ever seen it.
 */
export interface Farm {
  id: string;
  name: string;
  district: string;
  areaHectares: number;
  latitude: number;
  longitude: number;
  updatedAt: number;
}

export interface Scan {
  id: string;
  farmId: string;
  cropType: string;
  /** Captured photo held locally until the upload succeeds. */
  image: Blob;
  diagnosis: string | null;
  confidence: number | null;
  capturedAt: number;
  syncedAt: number | null;
}

export interface MarketPrice {
  id: string;
  commodity: string;
  market: string;
  pricePerKg: number;
  recordedAt: number;
}

export type OutboxOperation = 'create' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'failed';

/**
 * One queued write, awaiting a connection. `entityId` points at the local row
 * so the UI can show per-record sync state.
 */
export interface OutboxEntry {
  id: string;
  table: 'farms' | 'scans';
  entityId: string;
  operation: OutboxOperation;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  queuedAt: number;
}

export class AgriSenseDb extends Dexie {
  farms!: EntityTable<Farm, 'id'>;
  scans!: EntityTable<Scan, 'id'>;
  marketPrices!: EntityTable<MarketPrice, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;

  constructor() {
    super('agrisense');

    // Bump to a new version block rather than editing this one; Dexie replays
    // stores in order to migrate existing devices.
    this.version(1).stores({
      farms: 'id, district, updatedAt',
      scans: 'id, farmId, capturedAt, syncedAt',
      marketPrices: 'id, commodity, recordedAt',
      outbox: 'id, status, queuedAt, [table+entityId]',
    });
  }
}

export const db = new AgriSenseDb();
