import type { ZodIssue, ZodType, ZodTypeDef } from 'zod';

import { AppError } from '../errors/AppError';

/**
 * Validates untrusted input against a Zod schema, turning a failure into an
 * `AppError` rather than letting a `ZodError` travel as a raw throw.
 *
 * `errorHandler` would normalise a bare `ZodError` anyway, but doing it here
 * keeps the rule simple — everything a handler throws is an `AppError` — and
 * lets the caller say which part of the request failed.
 *
 * The schema's input side is `unknown` rather than `T`. What arrives here is
 * untrusted by definition, and tying input to output makes `T` resolve to the
 * *input* type for any schema carrying a `.default()` or a `.transform()` — so
 * a defaulted field would be typed optional despite always being present after
 * a successful parse.
 */
export function parseOrThrow<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  data: unknown,
  subject = 'request',
): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw AppError.validation(`Invalid ${subject}`, result.error.issues.map(describe));
}

function describe(issue: ZodIssue): { path: string; message: string } {
  return { path: issue.path.join('.'), message: issue.message };
}
