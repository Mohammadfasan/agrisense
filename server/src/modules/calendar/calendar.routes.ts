import { Router } from 'express';

import { asyncHandler } from '@shared';

import { authenticate, authorise } from '../auth';

import {
  completeTask,
  deleteTask,
  getTask,
  listTasks,
  listUpcoming,
  patchTask,
  putTask,
} from './calendar.controller';

export const calendarRouter: Router = Router();

/**
 * Authentication and role are applied to the whole router rather than per
 * route, so a handler added later cannot be left unguarded by omission.
 *
 * `authorise('farmer')` and not the wider set: these routes address the
 * caller's own calendar, and an officer has no crops of their own.
 */
calendarRouter.use(authenticate, authorise('farmer'));

/**
 * `/upcoming` is declared before `/:id` deliberately. Express matches in
 * declaration order, so the other way round the literal path would be read as
 * an id — and answer 422, because "upcoming" is not a UUID.
 */
calendarRouter.route('/upcoming').get(asyncHandler(listUpcoming));

calendarRouter.route('/').get(asyncHandler(listTasks));

/**
 * `PUT` on an id the client chose, rather than `POST` to the collection, for
 * the reason `plots.routes` gives: the client knows the UUID before the server
 * has heard of the task, so a replayed create lands on it instead of beside it.
 */
calendarRouter
  .route('/:id')
  .get(asyncHandler(getTask))
  .put(asyncHandler(putTask))
  .patch(asyncHandler(patchTask))
  .delete(asyncHandler(deleteTask));

/**
 * Completion as a sub-resource rather than a field on the task: `POST` says
 * "this happened" without the client having to decide what the rest of the
 * task should look like afterwards, which is what makes it safe to replay off
 * an offline queue.
 */
calendarRouter.route('/:id/complete').post(asyncHandler(completeTask));
