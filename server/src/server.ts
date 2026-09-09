import type { Server } from 'node:http';

import { connectDatabase, disconnectDatabase, env, logger } from '@config';
import { beginDraining } from '@shared';

import { createApp } from './app';

type Signal = 'SIGINT' | 'SIGTERM';
const SHUTDOWN_SIGNALS: Signal[] = ['SIGINT', 'SIGTERM'];

let shuttingDown = false;

/**
 * Boots the HTTP listener, then connects to MongoDB.
 *
 * The listener comes up first on purpose: if Mongo is unreachable the process
 * still answers `/health` and reports `not_ready` on `/ready`, which is what an
 * orchestrator needs to distinguish "broken" from "not ready yet". Mongoose
 * keeps retrying in the background.
 */
export async function startServer(): Promise<Server> {
  const app = createApp();

  const server = await listen(app, env.PORT, env.HOST);
  logger.info('HTTP server listening', {
    url: `http://${env.HOST}:${String(env.PORT)}`,
    nodeEnv: env.NODE_ENV,
    pid: process.pid,
  });

  try {
    await connectDatabase();
  } catch (error) {
    logger.error('Initial MongoDB connection failed; serving in not-ready state', {
      error: error instanceof Error ? error.message : error,
    });
  }

  registerShutdownHandlers(server);
  return server;
}

function listen(app: ReturnType<typeof createApp>, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

/**
 * Drains the server on a termination signal: stop accepting connections, let
 * in-flight requests finish, close MongoDB, then exit. A timer guarantees the
 * process dies even if a socket refuses to close.
 */
export function registerShutdownHandlers(server: Server): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void shutdown(server, signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.stack : reason,
    });
    void shutdown(server, 'unhandledRejection', 1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.stack ?? error.message });
    void shutdown(server, 'uncaughtException', 1);
  });
}

async function shutdown(server: Server, reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) {
    logger.warn('Shutdown already in progress', { reason });
    return;
  }
  shuttingDown = true;
  // Makes `drainGuard` start refusing new requests and `/ready` report
  // not_ready, before we begin tearing anything down.
  beginDraining();

  logger.info('Shutting down', { reason, timeoutMs: env.SHUTDOWN_TIMEOUT_MS });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(exitCode === 0 ? 1 : exitCode);
  }, env.SHUTDOWN_TIMEOUT_MS);
  // Do not let this timer hold the event loop open on a clean exit.
  forceExit.unref();

  try {
    await closeServer(server);
    logger.info('HTTP server closed');

    await disconnectDatabase();
    logger.info('MongoDB connection closed');

    logger.info('Shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : error,
    });
    exitCode = exitCode === 0 ? 1 : exitCode;
  } finally {
    clearTimeout(forceExit);
    process.exit(exitCode);
  }
}

/** How often to retire sockets that have fallen idle during the drain. */
const IDLE_SWEEP_INTERVAL_MS = 100;

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      clearInterval(sweep);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    // `server.close()` waits for every open socket, and an idle keep-alive
    // socket stays open until its keepAliveTimeout fires — which would stall
    // the drain for seconds. Sweep repeatedly, not once: a socket busy on the
    // first pass becomes idle on a later one.
    server.closeIdleConnections();
    const sweep = setInterval(() => {
      server.closeIdleConnections();
    }, IDLE_SWEEP_INTERVAL_MS);
    sweep.unref();
  });
}
