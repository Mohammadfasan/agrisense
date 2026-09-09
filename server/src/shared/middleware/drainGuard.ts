import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/AppError';
import { isDraining } from '../lifecycle';

/** Probes stay reachable while draining so orchestrators can observe the state. */
const PROBE_PATHS = new Set(['/health', '/ready']);

/**
 * While the process is draining, stop taking on new work.
 *
 * `server.close()` alone does not prevent this: an already-open keep-alive
 * socket will happily carry another request. Setting `Connection: close` tells
 * the client not to reuse the socket, and lets Node retire it as soon as the
 * current response is written — which is also what keeps the drain short.
 *
 * Probes are still answered; `/ready` reports `not_ready` on its own.
 */
export function drainGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isDraining()) {
    next();
    return;
  }

  res.setHeader('Connection', 'close');

  if (PROBE_PATHS.has(req.path)) {
    next();
    return;
  }

  next(AppError.serviceUnavailable('Server is shutting down'));
}
