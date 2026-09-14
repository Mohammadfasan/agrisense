import type { Response } from 'supertest';

/**
 * supertest types `Response.body` as `any`, which spreads unsafe member access
 * through every assertion. Casting in one place keeps the tests readable and
 * the strict lint rules meaningful everywhere else.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- there is nothing to infer the body shape from; the caller states it.
export function body<T>(response: Response): T {
  return response.body as T;
}
