import type { Request, Response } from 'express';

import { AppError, HttpStatus, parseOrThrow } from '@shared';

import type { RequestUser } from '../auth';

import { toFarmerView } from './scan.presenter';
import type { ScanService } from './scan.service';
import { scanFieldsSchema, scanIdSchema } from './scans.schemas';

/**
 * HTTP in, service call, farmer view out. No rules live here: ownership,
 * idempotency and diagnosis are the service's; what a farmer may see is the
 * presenter's.
 */
export function createScansController(service: ScanService) {
  /**
   * `PUT /scans/:id` -- multipart: `photo` (file), `capturedAt`, and optional
   * `plotId`, `longitude`, `latitude`. 201 when created, 200 for a replay.
   */
  async function putScan(req: Request, res: Response): Promise<void> {
    const user = requireUser(req);
    const scanId = parseOrThrow(scanIdSchema, req.params.id, 'scan id');

    if (!req.file) {
      throw AppError.validation('Invalid scan', [
        { path: 'photo', message: 'a photo file is required' },
      ]);
    }
    const fields = parseOrThrow(scanFieldsSchema, req.body, 'scan');

    const { scan, created } = await service.save(user.id, scanId, {
      plotId: fields.plotId,
      capturedAt: fields.capturedAt,
      photo: req.file.buffer,
      // Only present when both were sent. With `exactOptionalPropertyTypes`,
      // "no location" means the key is absent, not `location: undefined`.
      ...(fields.longitude !== undefined && fields.latitude !== undefined
        ? { location: { type: 'Point' as const, coordinates: [fields.longitude, fields.latitude] } }
        : {}),
    });

    res.status(created ? HttpStatus.CREATED : HttpStatus.OK).json({ scan: toFarmerView(scan) });
  }

  async function getScan(req: Request, res: Response): Promise<void> {
    const user = requireUser(req);
    const scanId = parseOrThrow(scanIdSchema, req.params.id, 'scan id');

    res.status(HttpStatus.OK).json({ scan: toFarmerView(await service.getById(user.id, scanId)) });
  }

  return { putScan, getScan };
}

/** Same reasoning as the plots controller: a missing user is a mis-wired route. */
function requireUser(req: Request): RequestUser {
  if (!req.user) {
    throw AppError.internal('scans controller was reached without authenticate()');
  }
  return req.user;
}
