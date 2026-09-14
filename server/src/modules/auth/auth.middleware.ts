import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { FarmerRole } from '@models';
import { AppError, ErrorCode, HttpStatus, asyncHandler } from '@shared';

import type { DistrictScope, RequestUser } from './auth.types';
import * as farmerRepository from './farmer.repository';
import { toRequestUser } from './auth.service';
import { verifyAccessToken } from './token.service';

/**
 * The three pieces of request-time authorisation: who you are, what you may
 * do, and which districts you may see.
 */

const BEARER = /^Bearer (.+)$/i;

/**
 * Verifies the access token and attaches `req.user`.
 *
 * The farmer is re-read from the database on every request rather than trusted
 * from the token claims. A 15-minute access token is otherwise a 15-minute
 * window in which a deactivated account keeps working, and deactivating an
 * account is exactly the sort of thing that needs to take effect now.
 */
export const authenticate: RequestHandler = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = extractBearer(req);
    // Throws TOKEN_EXPIRED or TOKEN_INVALID, which the client distinguishes:
    // the first means "refresh", the second means "log in again".
    const claims = verifyAccessToken(token);

    const farmer = await farmerRepository.findById(claims.sub);
    if (!farmer) {
      throw new AppError('Account no longer exists', HttpStatus.UNAUTHORIZED, {
        code: ErrorCode.TOKEN_INVALID,
      });
    }
    if (!farmer.isActive) {
      throw new AppError('This account is no longer active', HttpStatus.FORBIDDEN, {
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
    }

    req.user = toRequestUser(farmer);
    next();
  },
);

function extractBearer(req: Request): string {
  const header = req.get('authorization');
  const match = header ? BEARER.exec(header) : null;
  const token = match?.[1]?.trim();

  if (!token) {
    throw new AppError(
      'Authorization header with a bearer token is required',
      HttpStatus.UNAUTHORIZED,
      {
        code: ErrorCode.TOKEN_INVALID,
      },
    );
  }
  return token;
}

/**
 * Restricts a route to the given roles. Always mounted after {@link authenticate}.
 *
 * A missing `req.user` here is a routing mistake, not an unauthenticated
 * caller, so it fails as a 500 rather than quietly returning 401 and hiding
 * the mis-wired route.
 */
export function authorise(...roles: FarmerRole[]): RequestHandler {
  if (roles.length === 0) {
    // Thrown while routes are being registered, so this crashes startup rather
    // than shipping a route that admits nobody.
    throw AppError.internal('authorise() requires at least one role');
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = requireUser(req, 'authorise');

    if (!roles.includes(user.role)) {
      next(
        AppError.forbidden('Your role does not permit this action', {
          details: { required: roles, actual: user.role },
        }),
      );
      return;
    }
    next();
  };
}

export interface ScopeToDistrictOptions {
  /** Document field holding the district. Defaults to `district`. */
  field?: string;
}

/**
 * Attaches `req.scope`, a district restriction handlers merge into their own
 * filters.
 *
 * The alternative — every handler remembering to add its own district clause —
 * fails the first time someone forgets, and the failure is silent and reads
 * other districts' data. Here, forgetting `apply()` is visible in review as a
 * query that never mentions the scope at all.
 */
export function scopeToDistrict(options: ScopeToDistrictOptions = {}): RequestHandler {
  const field = options.field ?? 'district';

  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = requireUser(req, 'scopeToDistrict');
    req.scope = buildScope(user, field);
    next();
  };
}

/**
 * Admins are unrestricted; officers see their home district plus anything
 * explicitly assigned to them; everyone else sees only their own district.
 */
function buildScope(user: RequestUser, field: string): DistrictScope {
  const districts =
    user.role === 'admin'
      ? null
      : [...new Set([user.district, ...(user.role === 'officer' ? user.assignedDistricts : [])])];

  const filter = (): Record<string, unknown> =>
    districts === null ? {} : { [field]: { $in: districts } };

  return {
    districts,
    unrestricted: districts === null,
    filter,
    apply<T extends Record<string, unknown>>(query?: T): T & Record<string, unknown> {
      const base = query ?? ({} as T);
      if (districts === null) {
        return base;
      }
      // Overwriting a district the handler already chose would silently widen
      // the query past the scope; `$and` intersects instead, so an
      // out-of-scope request correctly returns nothing.
      if (field in base) {
        return { ...base, $and: [...toArray(base.$and), filter()] };
      }
      return { ...base, ...filter() };
    },
  };
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireUser(req: Request, middleware: string): RequestUser {
  if (!req.user) {
    throw AppError.internal(`${middleware}() was reached without authenticate()`);
  }
  return req.user;
}
