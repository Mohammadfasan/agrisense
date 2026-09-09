import type { Logger } from 'winston';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request, set by the `requestId` middleware. */
      id: string;
      /** Winston logger bound to `req.id`. */
      log: Logger;
    }
  }
}

export {};
