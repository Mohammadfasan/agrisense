import type { Logger } from 'winston';

import type { DistrictScope, RequestUser } from '../../modules/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request, set by the `requestId` middleware. */
      id: string;
      /** Winston logger bound to `req.id`. */
      log: Logger;
      /** The authenticated caller. Set by `authenticate`; absent otherwise. */
      user?: RequestUser;
      /**
       * District restriction for this request, set by `scopeToDistrict`.
       * Handlers merge it into their filters with `req.scope.apply(...)`.
       */
      scope?: DistrictScope;
    }
  }
}

export {};
