import mongoose, { type ConnectionStates } from 'mongoose';

import { env } from './env';
import { logger } from './logger';

export type DatabaseStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * `ConnectionStates` is a types-only enum; `mongoose.STATES` is its runtime
 * counterpart. Import the enum with `type` and read values off the default
 * export — a value-level named import from this CommonJS module compiles to
 * `__importDefault(...).ConnectionStates`, which is `undefined` at runtime.
 */
const STATES = mongoose.STATES;

const STATE_NAMES: Record<ConnectionStates, DatabaseStatus> = {
  [STATES.disconnected]: 'disconnected',
  [STATES.connected]: 'connected',
  [STATES.connecting]: 'connecting',
  [STATES.disconnecting]: 'disconnecting',
  [STATES.uninitialized]: 'disconnected',
};

let listenersBound = false;

/** Current mongoose connection state, mapped to a readable name. */
export function getDatabaseStatus(): DatabaseStatus {
  return STATE_NAMES[mongoose.connection.readyState];
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === STATES.connected;
}

/**
 * Open the MongoDB connection.
 *
 * Rejects if the initial connection cannot be established within
 * `MONGODB_SERVER_SELECTION_TIMEOUT_MS`. The caller decides whether that is
 * fatal — `index.ts` keeps serving `/health` so the process stays diagnosable
 * while mongoose retries in the background.
 */
export async function connectDatabase(): Promise<void> {
  bindConnectionListeners();

  // Surface bad queries as errors instead of silently buffering them forever.
  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    autoIndex: !env.isProduction,
  });
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === STATES.disconnected) {
    return;
  }
  await mongoose.disconnect();
}

/** Ping the server — used by `/ready` to prove the link is actually usable. */
export async function pingDatabase(): Promise<boolean> {
  const { db } = mongoose.connection;
  if (!isDatabaseConnected() || !db) {
    return false;
  }
  try {
    await db.admin().command({ ping: 1 });
    return true;
  } catch (error) {
    logger.debug('MongoDB ping failed', { error });
    return false;
  }
}

function bindConnectionListeners(): void {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected', { database: mongoose.connection.name });
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });
  mongoose.connection.on('error', (error: Error) => {
    logger.error('MongoDB connection error', { error: error.message });
  });
}
