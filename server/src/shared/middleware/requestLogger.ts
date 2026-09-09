import type { NextFunction, Request, Response } from 'express';

/** Paths that would otherwise flood the logs with probe traffic. */
const QUIET_PATHS = new Set(['/health', '/ready']);

/**
 * Logs one line per completed request at `http` level, with duration and status.
 * Registered after `requestId` so `req.log` carries the correlation id.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (QUIET_PATHS.has(req.path)) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log.http('request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
    });
  });

  next();
}
