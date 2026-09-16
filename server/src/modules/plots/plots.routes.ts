import { Router } from 'express';

import { asyncHandler } from '@shared';

import { authenticate, authorise } from '../auth';

import { deletePlot, getPlot, listPlots, patchPlot, putPlot } from './plots.controller';

export const plotsRouter: Router = Router();

/**
 * Authentication and role are applied to the whole router rather than per
 * route, so a handler added later cannot be left unguarded by omission.
 *
 * `authorise('farmer')` and not the wider set: these routes address the
 * caller's own plots, and an officer has none. Officer access to a farmer's
 * plots is a different question -- district-scoped, read-only -- and will be a
 * different route rather than a widened role list here.
 */
plotsRouter.use(authenticate, authorise('farmer'));

plotsRouter.route('/').get(asyncHandler(listPlots));

/**
 * `PUT` on an id the client chose, rather than `POST` to the collection: the
 * client already knows the UUID before the server has ever heard of the plot
 * (`docs/architecture.md`), so the resource has an address from the moment it
 * is created and a replayed create lands on it instead of beside it.
 */
plotsRouter
  .route('/:id')
  .get(asyncHandler(getPlot))
  .put(asyncHandler(putPlot))
  .patch(asyncHandler(patchPlot))
  .delete(asyncHandler(deletePlot));
