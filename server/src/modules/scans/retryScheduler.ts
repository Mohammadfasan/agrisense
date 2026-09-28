import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { logger } from '@config';

import type { SweepResult } from './scan.service';

/**
 * Runs the pending-scan retry sweep on a schedule.
 *
 * MongoDB stays the only source of truth for WHAT to retry (`nextAttemptAt`,
 * claimed atomically). This module only decides WHEN a sweep runs:
 *
 *  - With REDIS_URL: a BullMQ job scheduler. Every instance upserts the same
 *    scheduler id, so however many servers start there is one schedule, and
 *    each sweep job runs on exactly one worker. Redis losing its jobs loses
 *    nothing: the next sweep finds every due scan in MongoDB.
 *
 *  - Without it: a plain in-process interval. Fine for one instance and for
 *    development; with several instances the atomic claim still prevents
 *    double work, they just all sweep.
 *
 * Either way, sweeps never overlap, a failed sweep does not stop the next
 * one, and `stop()` waits for the sweep in progress before resolving.
 *
 * A Redis outage is logged ONCE when it starts and once when it ends. ioredis
 * reconnects every few hundred milliseconds, and logging each attempt would
 * bury every other error in the log within minutes.
 */

export interface RetrySchedulerOptions {
  sweep: () => Promise<SweepResult>;
  intervalMs: number;
  redisUrl?: string | undefined;
}

export interface RetryScheduler {
  mode: 'bullmq' | 'interval';
  stop(): Promise<void>;
}

const QUEUE_NAME = 'scan-retry';
const SCHEDULER_ID = 'scan-retry-sweep';

export function startRetryScheduler(options: RetrySchedulerOptions): RetryScheduler {
  return options.redisUrl ? startBullmq(options.redisUrl, options) : startInterval(options);
}

function startInterval({ sweep, intervalMs }: RetrySchedulerOptions): RetryScheduler {
  logger.warn('REDIS_URL is not set: scan retries run in-process', { everyMs: intervalMs });

  let running: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    // Never overlap: a slow sweep simply delays the next one.
    if (stopped || running !== null) {
      return;
    }
    running = sweep()
      .then(logSweep, (error: unknown) => {
        logger.error('Scan retry sweep failed', { error: describe(error) });
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, intervalMs);
  // A pending retry is not a reason to keep the process alive.
  timer.unref();

  return {
    mode: 'interval',
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

function startBullmq(
  redisUrl: string,
  { sweep, intervalMs }: RetrySchedulerOptions,
): RetryScheduler {
  // BullMQ workers hold blocking Redis commands; ioredis must not give up on them.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await sweep();
      logSweep(result);
      return result;
    },
    { connection, concurrency: 1 },
  );

  // One log line per outage, not one per reconnect attempt.
  let redisReachable = true;
  const onRedisError = (error: unknown): void => {
    if (!redisReachable) {
      return;
    }
    redisReachable = false;
    logger.error('Redis unreachable; scan retries paused until it is back', {
      error: describe(error),
    });
  };
  connection.on('error', onRedisError);
  connection.on('ready', () => {
    if (!redisReachable) {
      redisReachable = true;
      logger.info('Redis reachable again; scan retries resume');
    }
  });
  // Both also emit connection errors. A Node EventEmitter with no 'error'
  // listener THROWS on an 'error' event, so these listeners are what stop a
  // Redis outage from crashing the whole server.
  queue.on('error', onRedisError);
  worker.on('error', onRedisError);

  worker.on('failed', (_job, error) => {
    logger.error('Scan retry sweep failed', { error: describe(error) });
  });

  // Idempotent: the same id from every instance means one schedule, not N.
  // If Redis is down right now, this waits and resolves once it is back.
  queue
    .upsertJobScheduler(
      SCHEDULER_ID,
      { every: intervalMs },
      { name: 'sweep', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    )
    .then(() => {
      logger.info('Scan retries scheduled with BullMQ', { everyMs: intervalMs });
    })
    .catch((error: unknown) => {
      logger.error('Could not schedule scan retries', { error: describe(error) });
    });

  return {
    mode: 'bullmq',
    async stop() {
      // Waits for the job in progress, then takes no more.
      await worker.close();
      await queue.close();
      await connection.quit();
    },
  };
}

function logSweep(result: SweepResult): void {
  // Quiet when there was nothing to do, which is almost always.
  if (result.claimed > 0) {
    logger.info('Scan retry sweep', { ...result });
  }
}

/**
 * A useful message from any error. Node's connection errors need care: when
 * both IPv6 and IPv4 fail, it throws an AggregateError whose own message is
 * EMPTY, with the real reasons (and codes like ECONNREFUSED) inside.
 */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map(describe).filter((text) => text.length > 0);
    return inner.length > 0 ? inner.join('; ') : 'AggregateError';
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
    return `${error.message || error.name}${code}`;
  }
  return String(error);
}
