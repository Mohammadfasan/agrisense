import type { Request, Response } from 'express';

import {
  AppError,
  HttpStatus,
  calendarListQuerySchema,
  calendarTaskCompleteSchema,
  calendarTaskCreateSchema,
  calendarTaskIdSchema,
  calendarTaskUpdateSchema,
  calendarTodayQuerySchema,
  calendarUpcomingQuerySchema,
  parseOrThrow,
} from '@shared';
import type { RequestUser } from '@modules';

import * as service from './calendarTask.service';
import * as todayService from './calendarToday.service';

/**
 * `/calendar` — a farmer's own crop calendar, and nobody else's.
 *
 * Shaped exactly like `plots.controller`: every handler takes the owner from
 * {@link requireUser} and the id from the path, and hands both to the service,
 * which puts them in the query. No handler reads an owner out of a body; the
 * schemas have no field for one.
 *
 * The id is parsed through `calendarTaskIdSchema` rather than passed along raw.
 * It is a client-generated UUID, which makes it untrusted input that happens
 * to arrive in the path — and normalising its case here is what keeps `PUT`
 * idempotent across clients that disagree about capitalisation.
 */

export async function listTasks(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parseOrThrow(calendarListQuerySchema, req.query, 'calendar query');

  res.status(HttpStatus.OK).json({ tasks: await service.list(user.id, query) });
}

export async function listUpcoming(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parseOrThrow(calendarUpcomingQuerySchema, req.query, 'calendar query');

  res.status(HttpStatus.OK).json({ tasks: await service.upcoming(user.id, query) });
}

/**
 * The home screen: overdue, today and the next seven days, across every plot.
 *
 * The buckets are computed server-side and the day they were computed against
 * is echoed back, so a client never has to re-derive the boundaries from a
 * "today" of its own. At UTC+05:30 those two answers differ for five and a
 * half hours out of every twenty-four.
 */
export async function getToday(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parseOrThrow(calendarTodayQuerySchema, req.query, 'calendar query');

  const buckets =
    query.date === undefined
      ? await todayService.today(user.id)
      : await todayService.today(user.id, query.date);

  res.status(HttpStatus.OK).json(buckets);
}

export async function getTask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  res.status(HttpStatus.OK).json({ task: await service.getById(user.id, taskId(req)) });
}

export async function putTask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = parseOrThrow(calendarTaskCreateSchema, req.body, 'calendar task');

  const { task, created } = await service.save(user.id, taskId(req), input);

  res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json({ task });
}

export async function patchTask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const patch = parseOrThrow(calendarTaskUpdateSchema, req.body, 'calendar task');

  res.status(HttpStatus.OK).json({ task: await service.update(user.id, taskId(req), patch) });
}

/**
 * Completion is its own endpoint rather than a `PATCH` field, because it is
 * the one action a farmer takes standing in a field with one thumb, and it has
 * to survive being replayed off an offline queue. It returns the task so the
 * client can store what the server recorded rather than what it assumed.
 */
export async function completeTask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  // An empty body is the normal case: "done, today, wherever I am".
  const input = parseOrThrow(calendarTaskCompleteSchema, req.body ?? {}, 'completion');

  res.status(HttpStatus.OK).json({ task: await service.complete(user.id, taskId(req), input) });
}

export async function deleteTask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await service.softDelete(user.id, taskId(req));

  // No body: the client already knows what it deleted, and returning the
  // tombstone would invite treating a deleted task as readable.
  res.status(HttpStatus.NO_CONTENT).send();
}

/**
 * A malformed id is a 422 like any other bad input, not a 404. It says nothing
 * about which tasks exist -- no id of that shape could name one.
 */
function taskId(req: Request): string {
  return parseOrThrow(calendarTaskIdSchema, req.params.id, 'calendar task id');
}

/**
 * A missing `req.user` is a mis-wired route rather than an unauthenticated
 * caller -- `authenticate` would have thrown -- so it fails as a defect
 * instead of quietly answering 401 and hiding the mistake.
 */
function requireUser(req: Request): RequestUser {
  if (!req.user) {
    throw AppError.internal('calendar controller was reached without authenticate()');
  }
  return req.user;
}
