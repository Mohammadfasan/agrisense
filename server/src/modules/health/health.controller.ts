import type { Request, Response } from 'express';

import { HttpStatus } from '@shared';

import { getLiveness, getReadiness } from './health.service';

/** GET /health — liveness probe. 200 as long as the event loop is turning. */
export function healthCheck(_req: Request, res: Response): void {
  res.status(HttpStatus.OK).json(getLiveness());
}

/** GET /ready — readiness probe. 503 while a dependency is unavailable. */
export async function readinessCheck(_req: Request, res: Response): Promise<void> {
  const report = await getReadiness();
  const status = report.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

  // Probes must never be served from a cache.
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(report);
}
