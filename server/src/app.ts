import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from '@config';
import { authRouter, calendarRouter, farmersRouter, healthRouter, plotsRouter } from '@modules';
import { drainGuard, errorHandler, notFound, requestId, requestLogger } from '@shared';

/**
 * Builds the Express application. Kept free of side effects (no listening, no
 * database) so tests can mount it directly.
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer, trust the proxy so `req.ip` and protocol are real.
  app.set('trust proxy', env.isProduction ? 1 : false);
  app.disable('x-powered-by');

  // First in the chain: everything downstream, including body-parser failures,
  // must be attributable to a request id.
  app.use(requestId);
  app.use(requestLogger);

  // Refuse new work as soon as shutdown starts, including on sockets that
  // are already open.
  app.use(drainGuard);

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

  // Probes are mounted at the root, outside any API version prefix.
  app.use(healthRouter);

  app.use('/api/v1', createApiRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/** Versioned feature routers. New modules mount here. */
function createApiRouter(): express.Router {
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.json({ name: 'AgriSense API', version: 'v1' });
  });
  router.use('/auth', authRouter);
  router.use('/farmers', farmersRouter);
  router.use('/plots', plotsRouter);
  router.use('/calendar', calendarRouter);
  return router;
}
