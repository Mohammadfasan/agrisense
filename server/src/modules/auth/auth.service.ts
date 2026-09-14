import { randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { env, logger } from '@config';
import type { Farmer, OtpPurpose } from '@models';
import { AppError, ErrorCode, HttpStatus } from '@shared';
import { DEFAULT_LOCALE, type LocaleCode } from '@shared/types';

import type { RequestUser, TokenPair } from './auth.types';
import * as farmerRepository from './farmer.repository';
import { getSmsGateway } from './otp.delivery';
import * as otpRepository from './otp.repository';
import { maskPhone, normalisePhone } from './phone';
import * as refreshTokenRepository from './refreshToken.repository';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from './token.service';

/**
 * Authentication use cases. Owns the rules — rate limits, attempt ceilings,
 * rotation, reuse detection — and delegates every read and write to a
 * repository. Nothing here touches Express.
 */

/* -------------------------------------------------------------------------- */
/* OTP request                                                                 */
/* -------------------------------------------------------------------------- */

export interface RequestOtpInput {
  phone: string;
  purpose?: OtpPurpose;
}

export interface RequestOtpResult {
  phone: string;
  expiresAt: Date;
  expiresInSeconds: number;
  requestsRemaining: number;
  /**
   * Only ever populated under `OTP_DEV_MODE`, which cannot be enabled in
   * production. Lets the client and the integration tests complete a login
   * without an SMS provider.
   */
  devCode?: string;
}

export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const phone = normalisePhone(input.phone);
  const purpose: OtpPurpose = input.purpose ?? 'login';
  const now = new Date();

  const alreadyIssued = await enforceRequestRateLimit(phone, purpose, now);

  const code = generateCode(env.OTP_LENGTH);
  const codeHash = await bcrypt.hash(code, env.OTP_BCRYPT_ROUNDS);
  const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);

  await otpRepository.create({ phone, codeHash, purpose, expiresAt });

  // Delivery failure must not leave the caller believing a code is on its way.
  // The stored row is harmless and expires on its own.
  await getSmsGateway().send(phone, code);

  return {
    phone,
    expiresAt,
    expiresInSeconds: env.OTP_TTL_SECONDS,
    requestsRemaining: Math.max(0, env.OTP_MAX_REQUESTS_PER_WINDOW - alreadyIssued - 1),
    ...(env.otpDevMode ? { devCode: code } : {}),
  };
}

/**
 * `OTP_MAX_REQUESTS_PER_WINDOW` codes per phone per window.
 *
 * The limit is per phone rather than per IP because the phone is the thing
 * being billed for and spammed; an attacker rotating addresses would sail past
 * an IP-based limit while still ringing one victim's handset all night.
 *
 * Returns how many codes the window already holds, so the caller can report
 * the remaining allowance without counting them a second time.
 */
async function enforceRequestRateLimit(
  phone: string,
  purpose: OtpPurpose,
  now: Date,
): Promise<number> {
  const since = windowStart(now);
  const issued = await otpRepository.countIssuedSince(phone, purpose, since);

  if (issued < env.OTP_MAX_REQUESTS_PER_WINDOW) {
    return issued;
  }

  // The window frees up when the oldest request inside it ages out.
  const oldest = await otpRepository.findOldestIssuedSince(phone, purpose, since);
  const freesAt = oldest
    ? oldest.createdAt.getTime() + env.OTP_REQUEST_WINDOW_SECONDS * 1000
    : now.getTime() + env.OTP_REQUEST_WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));

  logger.warn('OTP request rate limit hit', { phone: maskPhone(phone), purpose, issued });

  throw AppError.tooManyRequests('Too many verification codes requested for this number', {
    code: ErrorCode.OTP_RATE_LIMITED,
    details: { retryAfterSeconds },
  });
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - env.OTP_REQUEST_WINDOW_SECONDS * 1000);
}

/**
 * A uniformly random decimal code, zero-padded so every code is the same
 * length. `randomInt`, not `Math.random`: this is a credential.
 */
function generateCode(length: number): string {
  const ceiling = 10 ** length;
  return String(randomInt(0, ceiling)).padStart(length, '0');
}

/* -------------------------------------------------------------------------- */
/* OTP verification                                                            */
/* -------------------------------------------------------------------------- */

/** Supplied on first login, when no farmer exists for the number yet. */
export interface FarmerProfileInput {
  name: string;
  district: string;
  language?: LocaleCode;
  dsDivision?: string;
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
  purpose?: OtpPurpose;
  deviceId?: string;
  profile?: FarmerProfileInput;
}

export interface AuthResult {
  user: RequestUser;
  tokens: TokenPair;
}

export async function verifyOtp(input: VerifyOtpInput): Promise<AuthResult> {
  const phone = normalisePhone(input.phone);
  const purpose: OtpPurpose = input.purpose ?? 'login';

  const otp = await otpRepository.findActive(phone, purpose);
  if (!otp) {
    throw new AppError('No valid verification code for this number', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.OTP_EXPIRED,
    });
  }
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw AppError.tooManyRequests('This verification code has been locked', {
      code: ErrorCode.OTP_ATTEMPTS_EXCEEDED,
    });
  }

  // Resolved before the code is checked, and therefore before it is burned: a
  // correct code should not be spent on a request that cannot complete anyway.
  const existing = await farmerRepository.findByPhone(phone);
  const profile = input.profile;
  if (!existing && !profile) {
    throw new AppError(
      'No account exists for this number; supply a profile to register',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { code: ErrorCode.PROFILE_REQUIRED },
    );
  }

  const matches = await bcrypt.compare(input.code, otp.codeHash);
  if (!matches) {
    const attempts = await otpRepository.incrementAttempts(otp._id);
    const remaining = Math.max(0, env.OTP_MAX_ATTEMPTS - attempts);

    if (remaining === 0) {
      throw AppError.tooManyRequests('Too many incorrect attempts; request a new code', {
        code: ErrorCode.OTP_ATTEMPTS_EXCEEDED,
      });
    }
    throw new AppError('Verification code is incorrect', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.OTP_INVALID,
      details: { attemptsRemaining: remaining },
    });
  }

  // Single use. This guarded update is the authority, not the read above: if a
  // concurrent request consumed the code first, this one loses.
  const consumed = await otpRepository.consume(otp._id);
  if (!consumed) {
    throw new AppError('Verification code has already been used', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.OTP_INVALID,
    });
  }

  const farmer = existing ? await loginExisting(existing) : await registerFarmer(phone, profile);

  const tokens = await issueTokens(farmer, input.deviceId);
  return { user: toRequestUser(farmer), tokens };
}

async function loginExisting(farmer: Farmer): Promise<Farmer> {
  assertUsable(farmer);
  // `markLoggedIn` re-reads under the same not-deleted guard, so a farmer
  // deleted between the two calls falls out here rather than getting a token.
  const updated = await farmerRepository.markLoggedIn(farmer._id);
  if (!updated) {
    throw inactiveAccount();
  }
  return updated;
}

async function registerFarmer(
  phone: string,
  profile: FarmerProfileInput | undefined,
): Promise<Farmer> {
  if (!profile) {
    // Unreachable: `verifyOtp` rejects this case before consuming the code.
    throw AppError.internal('Registration reached without a profile');
  }
  return farmerRepository.create({
    phone,
    name: profile.name,
    district: profile.district,
    language: profile.language ?? DEFAULT_LOCALE,
    ...(profile.dsDivision === undefined ? {} : { dsDivision: profile.dsDivision }),
  });
}

function assertUsable(farmer: Farmer): void {
  if (!farmer.isActive || farmer.deletedAt) {
    throw inactiveAccount();
  }
}

function inactiveAccount(): AppError {
  return new AppError('This account is no longer active', HttpStatus.FORBIDDEN, {
    code: ErrorCode.ACCOUNT_INACTIVE,
  });
}

/* -------------------------------------------------------------------------- */
/* Refresh rotation                                                            */
/* -------------------------------------------------------------------------- */

export interface RefreshInput {
  refreshToken: string;
  deviceId?: string;
}

/**
 * Exchanges a refresh token for a new pair, rotating the lineage.
 *
 * The replay case is the interesting one: a token that already carries
 * `replacedBy` cannot have come from a well-behaved client, because a
 * well-behaved client discarded it the moment it was rotated. Presenting one
 * means a copy is in circulation, and the only safe response is to end the
 * whole family — including the token the legitimate client still holds.
 */
export async function refresh(input: RefreshInput): Promise<TokenPair> {
  const claims = verifyRefreshToken(input.refreshToken);
  const presentedHash = hashToken(input.refreshToken);

  const stored = await refreshTokenRepository.findByHash(presentedHash);
  if (!stored) {
    throw unrecognisedToken();
  }

  if (stored.replacedBy) {
    await revokeFamilyForReuse(stored.farmerId, stored.familyId, claims.jti);
  }
  if (stored.revokedAt) {
    throw new AppError('Refresh token has been revoked', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.TOKEN_REVOKED,
    });
  }
  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new AppError('Refresh token has expired', HttpStatus.UNAUTHORIZED, {
      code: ErrorCode.TOKEN_EXPIRED,
    });
  }

  const farmer = await farmerRepository.findById(stored.farmerId.toString());
  if (!farmer) {
    throw unrecognisedToken();
  }
  assertUsable(farmer);

  const issued = signRefreshToken(farmer._id.toString(), stored.familyId);
  await refreshTokenRepository.create({
    farmerId: farmer._id,
    tokenHash: issued.tokenHash,
    familyId: issued.familyId,
    expiresAt: issued.expiresAt,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
  });

  // Stamped after the replacement exists, so a crash between the two leaves
  // the client with a usable token rather than none. `false` means something
  // else rotated this token first — indistinguishable from a replay, and
  // treated as one.
  const rotated = await refreshTokenRepository.markRotated(presentedHash, issued.tokenHash);
  if (!rotated) {
    await revokeFamilyForReuse(stored.farmerId, stored.familyId, claims.jti);
  }

  return buildTokenPair(farmer, issued.token);
}

function unrecognisedToken(): AppError {
  return new AppError('Refresh token is not recognised', HttpStatus.UNAUTHORIZED, {
    code: ErrorCode.TOKEN_INVALID,
  });
}

async function revokeFamilyForReuse(
  farmerId: Farmer['_id'],
  familyId: string,
  jti: string,
): Promise<never> {
  const revoked = await refreshTokenRepository.revokeFamily(farmerId, familyId);
  logger.warn('Refresh token reuse detected; family revoked', {
    farmerId: farmerId.toString(),
    familyId,
    jti,
    revoked,
  });
  throw new AppError('Refresh token has already been used', HttpStatus.UNAUTHORIZED, {
    code: ErrorCode.TOKEN_REUSED,
  });
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

async function issueTokens(farmer: Farmer, deviceId?: string): Promise<TokenPair> {
  const issued = signRefreshToken(farmer._id.toString());
  await refreshTokenRepository.create({
    farmerId: farmer._id,
    tokenHash: issued.tokenHash,
    familyId: issued.familyId,
    expiresAt: issued.expiresAt,
    ...(deviceId === undefined ? {} : { deviceId }),
  });
  return buildTokenPair(farmer, issued.token);
}

function buildTokenPair(farmer: Farmer, refreshToken: string): TokenPair {
  return {
    tokenType: 'Bearer',
    accessToken: signAccessToken({
      sub: farmer._id.toString(),
      role: farmer.role,
      district: farmer.district,
    }),
    refreshToken,
    expiresIn: env.jwt.accessTtlSeconds,
  };
}

/** Projects a farmer document down to what a request handler is allowed to see. */
export function toRequestUser(farmer: Farmer): RequestUser {
  return {
    id: farmer._id.toString(),
    phone: farmer.phone,
    name: farmer.name,
    role: farmer.role,
    language: farmer.language,
    district: farmer.district,
    ...(farmer.dsDivision === undefined ? {} : { dsDivision: farmer.dsDivision }),
    assignedDistricts: farmer.assignedDistricts,
    isActive: farmer.isActive,
    isVerified: farmer.isVerified,
  };
}
