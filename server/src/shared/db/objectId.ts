import { Types } from 'mongoose';

import { AppError } from '../errors/AppError';

/**
 * Turns an authenticated user's id back into an `ObjectId`.
 *
 * `req.user.id` is a string that came off a verified token and was then used
 * to load a real farmer, so it is well-formed by the time any service sees it.
 * A malformed one is a defect upstream, not a bad request, and fails as a 500
 * rather than a 400 that would send the client off retrying a good token.
 *
 * Never use this on a value that came out of a request body or path: those are
 * untrusted and belong to a Zod schema, which produces a 422.
 */
export function toObjectId(userId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(userId)) {
    throw AppError.internal('Authenticated user id is not an ObjectId');
  }
  return new Types.ObjectId(userId);
}
