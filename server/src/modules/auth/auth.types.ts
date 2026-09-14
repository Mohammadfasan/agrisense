import type { FarmerRole } from '@models';
import type { LocaleCode } from '@shared/types';

/**
 * The authenticated caller, as attached to `req.user`.
 *
 * A deliberate projection of the farmer document rather than the document
 * itself: handlers get the fields authorisation actually turns on, and nothing
 * that would be embarrassing to serialise by accident (push subscription keys,
 * notification preferences).
 */
export interface RequestUser {
  id: string;
  phone: string;
  name: string;
  role: FarmerRole;
  language: LocaleCode;
  district: string;
  dsDivision?: string;
  /** Officers only; empty for everyone else. */
  assignedDistricts: string[];
  isActive: boolean;
  isVerified: boolean;
}

/**
 * The set of districts this request may touch, plus the helpers that put that
 * restriction into a query.
 *
 * Handlers call `apply()` on the filter they were going to run anyway, so a
 * forgotten `district` clause cannot quietly widen a query beyond the caller's
 * remit. `unrestricted` exists for the admin case, where the correct filter is
 * genuinely no filter at all.
 */
export interface DistrictScope {
  /** `null` means unrestricted — do not treat it as "no districts". */
  readonly districts: readonly string[] | null;
  readonly unrestricted: boolean;
  /** The clause on its own, e.g. `{ district: { $in: [...] } }`. */
  filter(): Record<string, unknown>;
  /** Merges {@link filter} into an existing query filter. */
  apply<T extends Record<string, unknown>>(query?: T): T & Record<string, unknown>;
}

/** What the client receives on a successful verify or refresh. */
export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds; the refresh lifetime is server-owned. */
  expiresIn: number;
}

/** Claims carried by an access token. */
export interface AccessTokenClaims {
  sub: string;
  typ: 'access';
  role: FarmerRole;
  district: string;
}

/** Claims carried by a refresh token. `fam` is the revocation unit. */
export interface RefreshTokenClaims {
  sub: string;
  typ: 'refresh';
  fam: string;
  jti: string;
}
