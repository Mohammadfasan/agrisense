import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import type { Logger } from 'winston';
import { ZodError } from 'zod';

import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError, ErrorCode, isAppError } from '../errors/AppError';
import { HttpStatus } from '../http/statusCodes';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * Terminal error middleware. Normalises anything thrown during a request into
 * the same JSON envelope and decides how loudly to log it.
 *
 * Express 4 identifies this as an error handler by its four-argument arity, so
 * `_next` must stay in the signature even though it is unused.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = normalise(error);
  const { id: requestId, log } = requestContext(req);

  if (appError.isOperational) {
    log.warn('request failed', {
      code: appError.code,
      status: appError.statusCode,
      message: appError.message,
      path: req.originalUrl,
      method: req.method,
    });
  } else {
    log.error('unhandled request error', {
      code: appError.code,
      status: appError.statusCode,
      message: appError.message,
      path: req.originalUrl,
      method: req.method,
      stack: appError.stack,
      cause: appError.cause,
    });
  }

  // A thrown error after headers are sent can only be handled by tearing the
  // response down; Express' default handler does exactly this.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  // Never leak internals of a defect to clients in production.
  const exposeMessage = appError.isOperational || !env.isProduction;

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: exposeMessage ? appError.message : 'Internal server error',
      requestId,
    },
  };

  if (appError.details !== undefined) {
    body.error.details = appError.details;
  }
  if (!env.isProduction && appError.stack) {
    body.error.stack = appError.stack;
  }

  res.status(appError.statusCode).json(body);
}

/**
 * `requestId` populates `req.id`/`req.log` for every normal request, but this
 * handler is the last line of defence and can also run for a request that
 * failed before that middleware — so read them defensively rather than trusting
 * the global type augmentation.
 */
function requestContext(req: Request): { id: string; log: Logger } {
  const partial = req as Partial<Pick<Request, 'id' | 'log'>>;
  return { id: partial.id ?? 'unknown', log: partial.log ?? logger };
}

/** Map known error shapes onto AppError; anything else becomes a 500 defect. */
function normalise(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return AppError.validation('Request validation failed', formatZodIssues(error));
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    return AppError.validation('Document validation failed', details);
  }

  if (error instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Invalid value for "${error.path}"`, {
      code: ErrorCode.VALIDATION_ERROR,
    });
  }

  if (isDuplicateKeyError(error)) {
    return AppError.conflict('Resource already exists', { details: error.keyValue });
  }

  // Express' body parser marks malformed JSON with a status and `type`.
  if (isBodyParserError(error)) {
    return AppError.badRequest('Malformed request body');
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  return new AppError(message, HttpStatus.INTERNAL_SERVER_ERROR, {
    code: ErrorCode.INTERNAL_ERROR,
    isOperational: false,
    cause: error,
  });
}

function formatZodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function isDuplicateKeyError(error: unknown): error is { keyValue?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isBodyParserError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: unknown }).status === 400 &&
    'body' in error
  );
}
