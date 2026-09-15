import type { Request, Response } from 'express';

import {
  AppError,
  HttpStatus,
  farmerProfileSchema,
  farmerProfileUpdateSchema,
  parseOrThrow,
} from '@shared';
import type { RequestUser } from '@modules';

import * as service from './farmerProfile.service';

/**
 * `/farmers/me` — read and write the caller's own profile.
 *
 * Every handler takes the owner from {@link requireUser} and the payload from
 * a schema that has no `userId` field. There is deliberately no route that
 * takes an id: "me" is the only addressable profile, so a farmer reaching
 * another farmer's row would take a new endpoint, not a crafted request.
 */

export async function getMyProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  res.status(HttpStatus.OK).json({ profile: await service.getByUserId(user.id) });
}

export async function putMyProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = parseOrThrow(farmerProfileSchema, req.body, 'farmer profile');

  // The farmer's sign-in language stands in when the body omits one.
  const { profile, created } = await service.replace(user.id, input, user.language);

  res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json({ profile });
}

export async function patchMyProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const patch = parseOrThrow(farmerProfileUpdateSchema, req.body, 'farmer profile');

  res.status(HttpStatus.OK).json({ profile: await service.update(user.id, patch) });
}

/**
 * A missing `req.user` is a mis-wired route rather than an unauthenticated
 * caller -- `authenticate` would have thrown -- so it fails as a defect
 * instead of quietly answering 401 and hiding the mistake.
 */
function requireUser(req: Request): RequestUser {
  if (!req.user) {
    throw AppError.internal('farmers controller was reached without authenticate()');
  }
  return req.user;
}
