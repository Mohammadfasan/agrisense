import { createHash, randomUUID } from 'node:crypto';

import jwt, { type Algorithm } from 'jsonwebtoken';

import { env } from '@config';
import { AppError, ErrorCode, HttpStatus } from '@shared';

import type { AccessTokenClaims, RefreshTokenClaims } from './auth.types';

/**
 * Token minting and verification. Knows about signatures and clocks; knows
 * nothing about the database — rotation state lives in `refreshToken.repository`.
 *
 * Access and refresh tokens are signed with different secrets, so neither can
 * be presented where the other is expected even if a handler forgets to check
 * the `typ` claim (it checks anyway).
 */

const ALGORITHM: Algorithm = 'HS256';

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  familyId: string;
  jti: string;
  expiresAt: Date;
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'typ'>): string {
  const payload: AccessTokenClaims = { ...claims, typ: 'access' };
  return jwt.sign(payload, env.jwt.accessSecret, {
    algorithm: ALGORITHM,
    expiresIn: env.jwt.accessTtlSeconds,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

/**
 * Mints a refresh token. `familyId` is omitted on first login (a new lineage)
 * and passed through on every rotation, so the whole chain stays revocable as
 * one unit.
 */
export function signRefreshToken(
  farmerId: string,
  familyId: string = randomUUID(),
): IssuedRefreshToken {
  const jti = randomUUID();
  const payload: RefreshTokenClaims = { sub: farmerId, typ: 'refresh', fam: familyId, jti };

  const token = jwt.sign(payload, env.jwt.refreshSecret, {
    algorithm: ALGORITHM,
    expiresIn: env.jwt.refreshTtlSeconds,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });

  return {
    token,
    tokenHash: hashToken(token),
    familyId,
    jti,
    expiresAt: new Date(Date.now() + env.jwt.refreshTtlSeconds * 1000),
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = verify(token, env.jwt.accessSecret);
  if (payload.typ !== 'access' || !isNonEmptyString(payload.sub)) {
    throw invalidToken('Access token expected');
  }
  return {
    sub: payload.sub,
    typ: 'access',
    role: payload.role as AccessTokenClaims['role'],
    district: typeof payload.district === 'string' ? payload.district : '',
  };
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const payload = verify(token, env.jwt.refreshSecret);
  if (
    payload.typ !== 'refresh' ||
    !isNonEmptyString(payload.sub) ||
    !isNonEmptyString(payload.fam) ||
    !isNonEmptyString(payload.jti)
  ) {
    throw invalidToken('Refresh token expected');
  }
  return { sub: payload.sub, typ: 'refresh', fam: payload.fam, jti: payload.jti };
}

/**
 * SHA-256, per `docs/schema.md` §3 — not bcrypt.
 *
 * A refresh token is 200-odd bits of signed randomness, not a guessable
 * secret, so there is nothing for a work factor to defend against; and lookup
 * by hash has to be a single indexed equality match, which a salted digest
 * cannot give.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function verify(token: string, secret: string): Record<string, unknown> {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('Token has expired', HttpStatus.UNAUTHORIZED, {
        code: ErrorCode.TOKEN_EXPIRED,
        cause: error,
      });
    }
    throw invalidToken('Token is invalid', error);
  }

  // `jwt.verify` resolves to a string for tokens whose payload is not JSON.
  if (typeof decoded !== 'object' || decoded === null) {
    throw invalidToken('Token payload is not an object');
  }
  return decoded as Record<string, unknown>;
}

function invalidToken(message: string, cause?: unknown): AppError {
  return new AppError(message, HttpStatus.UNAUTHORIZED, { code: ErrorCode.TOKEN_INVALID, cause });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
