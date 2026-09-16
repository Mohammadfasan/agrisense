import type { Request, Response } from 'express';

import {
  AppError,
  HttpStatus,
  parseOrThrow,
  plotCreateSchema,
  plotIdSchema,
  plotListQuerySchema,
  plotUpdateSchema,
} from '@shared';
import type { RequestUser } from '@modules';

import * as service from './plot.service';

/**
 * `/plots` -- a farmer's own plots, and nobody else's.
 *
 * Every handler takes the owner from {@link requireUser} and the plot id from
 * the path, and hands both to the service, which puts them in the query. No
 * handler here reads an owner out of a body; the schemas have no field for one.
 *
 * The id is parsed through `plotIdSchema` rather than passed along as a raw
 * string. It is a client-generated UUID (`docs/architecture.md`), which makes
 * it untrusted input that happens to arrive in the path -- and normalising its
 * case here is what keeps `PUT` idempotent across clients that disagree about
 * capitalisation.
 */

export async function listPlots(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = parseOrThrow(plotListQuerySchema, req.query, 'plot list query');

  res.status(HttpStatus.OK).json(await service.list(user.id, query));
}

export async function getPlot(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  res.status(HttpStatus.OK).json({ plot: await service.getById(user.id, plotId(req)) });
}

export async function putPlot(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = parseOrThrow(plotCreateSchema, req.body, 'plot');

  const { plot, created } = await service.save(user.id, plotId(req), input);

  res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json({ plot });
}

export async function patchPlot(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const patch = parseOrThrow(plotUpdateSchema, req.body, 'plot');

  res.status(HttpStatus.OK).json({ plot: await service.update(user.id, plotId(req), patch) });
}

export async function deletePlot(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  await service.softDelete(user.id, plotId(req));

  // No body: the client already knows what it deleted, and returning the
  // tombstone would invite treating a deleted plot as readable.
  res.status(HttpStatus.NO_CONTENT).send();
}

/**
 * A malformed id is a 422 like any other bad input, not a 404. It says nothing
 * about which plots exist -- no id of that shape could name one.
 */
function plotId(req: Request): string {
  return parseOrThrow(plotIdSchema, req.params.id, 'plot id');
}

/**
 * A missing `req.user` is a mis-wired route rather than an unauthenticated
 * caller -- `authenticate` would have thrown -- so it fails as a defect
 * instead of quietly answering 401 and hiding the mistake.
 */
function requireUser(req: Request): RequestUser {
  if (!req.user) {
    throw AppError.internal('plots controller was reached without authenticate()');
  }
  return req.user;
}
