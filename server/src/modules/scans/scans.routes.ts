import { Router } from 'express';

import { env } from '@config';
import { asyncHandler } from '@shared';

import { authenticate, authorise } from '../auth';

import { createMlClient } from './mlClient';
import { LocalPhotoStorage } from './photoStorage';
import { createScanService, type ScanService } from './scan.service';
import { createScansController } from './scans.controller';
import { receivePhoto } from './upload';

/**
 * Built from a service rather than importing one, so tests can mount the same
 * routes over a temporary directory and a fake ML client.
 *
 * Authentication and role for the whole router, as in `plots.routes`. The
 * upload parser runs after them, per route: nobody's upload is parsed before
 * we know who they are.
 */
export function createScansRouter(service: ScanService): Router {
  const router = Router();
  const controller = createScansController(service);

  router.use(authenticate, authorise('farmer'));

  // `PUT` on the client's UUID, like plots: a replayed upload lands on the
  // scan it already created instead of beside it.
  router
    .route('/:id')
    .get(asyncHandler(controller.getScan))
    .put(receivePhoto, asyncHandler(controller.putScan));

  return router;
}

/** The production wiring: photos on local disk, the real ml-service. */
export const scansRouter: Router = createScansRouter(
  createScanService({
    storage: new LocalPhotoStorage(env.scans.uploadDir),
    ml: createMlClient(env.ml),
  }),
);
