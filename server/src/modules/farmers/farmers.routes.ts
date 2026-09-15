import { Router } from 'express';

import { asyncHandler } from '@shared';

import { authenticate, authorise } from '../auth';

import { getMyProfile, patchMyProfile, putMyProfile } from './farmers.controller';

export const farmersRouter: Router = Router();

/**
 * Authentication and role are applied to the whole router rather than per
 * route, so a handler added later cannot be left unguarded by omission.
 *
 * `authorise('farmer')` and not the wider set: officers and admins have no
 * farmer profile of their own to read or write, and letting them through here
 * would create one for them the first time someone sent a PUT by mistake.
 */
farmersRouter.use(authenticate, authorise('farmer'));

farmersRouter
  .route('/me')
  .get(asyncHandler(getMyProfile))
  .put(asyncHandler(putMyProfile))
  .patch(asyncHandler(patchMyProfile));
