import { Router } from 'express';

import { asyncHandler } from '@shared';

import { authenticate, authorise } from '../auth';

import {
  completeTask,
  deleteTask,
  getTask,
  getToday,
  listTasks,
  listUpcoming,
  patchTask,
  putTask,
} from './calendar.controller';
import { generateCalendar } from './calendarGeneration.controller';

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

/**
 * `/today` is declared here, with `/upcoming`, and for the same reason: ahead
 * of `/:id`, which would otherwise read the literal path as an id and answer
 * 422 because "today" is not a UUID.
 */
calendarRouter.route('/today').get(asyncHandler(getToday));

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

/**
 * `POST /plots/:plotId/calendar/generate`, mounted by `plots.routes` rather
 * than here.
 *
 * A router of its own, with `mergeParams`, because the route is addressed
 * under `/plots` — the thing being generated is a *plot's* calendar, and the
 * plot id belongs in the path that names the plot. `mergeParams` is what lets
 * this router see `:plotId`, which was matched by its parent.
 *
 * It carries its own `authenticate`/`authorise` rather than relying on the
 * parent's, so that mounting it somewhere else later cannot leave it
 * unguarded by omission.
 */
export const plotCalendarRouter: Router = Router({ mergeParams: true });

plotCalendarRouter.use(authenticate, authorise('farmer'));

plotCalendarRouter.route('/generate').post(asyncHandler(generateCalendar));
