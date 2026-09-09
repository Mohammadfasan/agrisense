import { Router } from 'express';

import { asyncHandler } from '@shared';

import { healthCheck, readinessCheck } from './health.controller';

export const healthRouter: Router = Router();

healthRouter.get('/health', healthCheck);
healthRouter.get('/ready', asyncHandler(readinessCheck));
