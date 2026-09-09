import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/AppError';

/** Terminal route: converts an unmatched path into a 404 AppError. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
