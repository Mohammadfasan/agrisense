import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { childLogger } from '../../config/logger';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Only trust an inbound id that is short and safe to echo into a header/log. */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Assigns `req.id` (reusing an upstream `X-Request-Id` when present and sane),
 * echoes it on the response, and attaches a logger bound to it as `req.log`.
 *
 * Must be registered before any middleware that logs.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  req.log = childLogger(id);
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
}
