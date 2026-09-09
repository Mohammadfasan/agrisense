import { logger } from '@config';

import { startServer } from './server';

startServer().catch((error: unknown) => {
  logger.error('Fatal error during startup', {
    error: error instanceof Error ? (error.stack ?? error.message) : error,
  });
  process.exit(1);
});
