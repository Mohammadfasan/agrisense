import type { ZodIssue, ZodType } from 'zod';

import { AppError } from '../errors/AppError';

/**
 * Validates untrusted input against a Zod schema, turning a failure into an
 * `AppError` rather than letting a `ZodError` travel as a raw throw.
 *
 * `errorHandler` would normalise a bare `ZodError` anyway, but doing it here
 * keeps the rule simple — everything a handler throws is an `AppError` — and
 * lets the caller say which part of the request failed.
 */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown, subject = 'request'): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw AppError.validation(`Invalid ${subject}`, result.error.issues.map(describe));
}

function describe(issue: ZodIssue): { path: string; message: string } {
  return { path: issue.path.join('.'), message: issue.message };
}
