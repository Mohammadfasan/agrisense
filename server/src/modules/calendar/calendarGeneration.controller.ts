import type { Request, Response } from 'express';

import { AppError, HttpStatus, calendarGenerateSchema, parseOrThrow, plotIdSchema } from '@shared';
import type { RequestUser } from '@modules';

import * as service from './calendarGeneration.service';

/**
 * `POST /plots/:plotId/calendar/generate` — build a plot's season.
 *
 * Shaped like the rest of the calendar controllers: the owner comes from the
 * token, the plot id from the path, and both go to the service, which puts
 * them in the query. No handler here reads an owner out of a body.
 */
export async function generateCalendar(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const plotId = parseOrThrow(plotIdSchema, req.params.plotId, 'plot id');
  const input = parseOrThrow(calendarGenerateSchema, req.body, 'calendar generation');

  const { tasks, created, supersededCount } = await service.generateForPlot(user.id, plotId, input);

  // `200` on a replay, `201` on a run that actually wrote something. A client
  // retrying after a lost response gets the same tasks either way; the status
  // is what tells it whether its first attempt had already landed.
  res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json({
    tasks,
    generationBatchId: input.generationBatchId,
    sowingDate: input.sowingDate,
    supersededCount,
  });
}

/**
 * A missing `req.user` is a mis-wired route rather than an unauthenticated
 * caller -- `authenticate` would have thrown -- so it fails as a defect
 * instead of quietly answering 401 and hiding the mistake.
 */
function requireUser(req: Request): RequestUser {
  if (!req.user) {
    throw AppError.internal('calendar generation controller was reached without authenticate()');
  }
  return req.user;
}
