import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app';
import { FarmerModel, OtpModel, RefreshTokenModel, type Farmer } from '@models';

import { body } from '../../test/http';

import type { RequestUser, TokenPair } from './auth.types';
import { signRefreshToken } from './token.service';

/**
 * End-to-end coverage of the auth module against a real MongoDB.
 *
 * The tests go through Express and out to the database on purpose: the parts
 * of this feature that can actually go wrong — a guarded update losing a race,
 * a unique index missing, a rotated token still being accepted — are invisible
 * to a test that stubs the repositories.
 */

const app = createApp();

const LOCAL_PHONE = '0771234567';
const E164_PHONE = '+94771234567';
const PROFILE = { name: 'Nimal Perera', district: 'Kandy', language: 'si' as const };

interface OtpRequestBody {
  phone: string;
  expiresAt: string;
  expiresInSeconds: number;
  requestsRemaining: number;
  devCode: string;
}

interface AuthBody {
  user: RequestUser;
  tokens: TokenPair;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

async function requestCode(phone = LOCAL_PHONE): Promise<string> {
  const response = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  expect(response.status).toBe(200);
  return body<OtpRequestBody>(response).devCode;
}

/** Requests a code and verifies it, registering the farmer on the way through. */
async function login(phone = LOCAL_PHONE): Promise<AuthBody> {
  const code = await requestCode(phone);
  const response = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code, profile: PROFILE, deviceId: 'test-device' });

  expect(response.status).toBe(200);
  return body<AuthBody>(response);
}

function refresh(refreshToken: string): Promise<request.Response> {
  return request(app).post('/api/v1/auth/refresh').send({ refreshToken });
}

/* -------------------------------------------------------------------------- */

describe('POST /auth/otp/request', () => {
  it('issues a code against the normalised E.164 number', async () => {
    const response = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: LOCAL_PHONE });

    expect(response.status).toBe(200);
    const payload = body<OtpRequestBody>(response);
    expect(payload.phone).toBe(E164_PHONE);
    expect(payload.devCode).toMatch(/^\d{6}$/);
    expect(payload.requestsRemaining).toBe(2);

    // The row is keyed by the normalised number, not what the user typed.
    await expect(OtpModel.countDocuments({ phone: E164_PHONE })).resolves.toBe(1);
  });

  it('stores the code as a bcrypt hash, never in plaintext', async () => {
    const code = await requestCode();

    const stored = await OtpModel.findOne({ phone: E164_PHONE }).lean().exec();
    expect(stored).not.toBeNull();
    expect(stored?.codeHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.codeHash).not.toContain(code);
    expect(stored?.consumedAt).toBeNull();
    expect(stored?.attempts).toBe(0);
  });

  it('treats the local and E.164 spellings of a number as the same phone', async () => {
    await requestCode(LOCAL_PHONE);
    await requestCode(E164_PHONE);
    await requestCode('94 77 123 4567');

    // Three spellings, one phone — so the fourth request is rate limited.
    const response = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: LOCAL_PHONE });
    expect(response.status).toBe(429);
  });

  it('rate limits to three codes per phone per window', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await requestCode();
    }

    const response = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: LOCAL_PHONE });

    expect(response.status).toBe(429);
    const payload = body<ErrorBody>(response);
    expect(payload.error.code).toBe('OTP_RATE_LIMITED');
    const details = payload.error.details as { retryAfterSeconds: number };
    expect(details.retryAfterSeconds).toBeGreaterThan(0);
    expect(details.retryAfterSeconds).toBeLessThanOrEqual(3600);

    // The limit is per phone: a different number is unaffected.
    await expect(requestCode('0712223333')).resolves.toMatch(/^\d{6}$/);
  });

  it('rejects a number that is not valid E.164', async () => {
    const response = await request(app).post('/api/v1/auth/otp/request').send({ phone: '12345' });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });
});

/* -------------------------------------------------------------------------- */

describe('POST /auth/otp/verify', () => {
  it('registers a new farmer and returns a token pair', async () => {
    const { user, tokens } = await login();

    expect(user).toMatchObject({
      phone: E164_PHONE,
      name: PROFILE.name,
      district: PROFILE.district,
      language: 'si',
      role: 'farmer',
      isVerified: true,
      isActive: true,
    });
    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);

    const farmer = await FarmerModel.findOne({ phone: E164_PHONE }).lean<Farmer>().exec();
    expect(farmer?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('logs an existing farmer in without a profile, and does not duplicate them', async () => {
    await login();
    const code = await requestCode();

    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code });

    expect(response.status).toBe(200);
    expect(body<AuthBody>(response).user.name).toBe(PROFILE.name);
    await expect(FarmerModel.countDocuments({ phone: E164_PHONE })).resolves.toBe(1);
  });

  it('requires a profile the first time a number is seen', async () => {
    const code = await requestCode();

    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('PROFILE_REQUIRED');

    // The code was not spent on a request that could not have succeeded.
    const stored = await OtpModel.findOne({ phone: E164_PHONE }).lean().exec();
    expect(stored?.consumedAt).toBeNull();
  });

  it('consumes the code, so the same one cannot be used twice', async () => {
    const code = await requestCode();

    const first = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code, profile: PROFILE });
    expect(first.status).toBe(200);

    const stored = await OtpModel.findOne({ phone: E164_PHONE }).lean().exec();
    expect(stored?.consumedAt).toBeInstanceOf(Date);

    const second = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code });

    // The consumed code is no longer an active code at all.
    expect(second.status).toBe(401);
    expect(body<ErrorBody>(second).error.code).toBe('OTP_EXPIRED');
  });

  it('counts down attempts and locks the code after three wrong guesses', async () => {
    await login();
    await requestCode();

    const wrong = (): Promise<request.Response> =>
      request(app).post('/api/v1/auth/otp/verify').send({ phone: LOCAL_PHONE, code: '000000' });

    const first = await wrong();
    expect(first.status).toBe(401);
    expect(body<ErrorBody>(first).error).toMatchObject({
      code: 'OTP_INVALID',
      details: { attemptsRemaining: 2 },
    });

    const second = await wrong();
    expect(body<ErrorBody>(second).error.details).toMatchObject({ attemptsRemaining: 1 });

    const third = await wrong();
    expect(third.status).toBe(429);
    expect(body<ErrorBody>(third).error.code).toBe('OTP_ATTEMPTS_EXCEEDED');

    const stored = await OtpModel.findOne({ phone: E164_PHONE })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    expect(stored?.attempts).toBe(3);
  });

  it('refuses the correct code once the attempt ceiling is reached', async () => {
    await login();
    const code = await requestCode();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: LOCAL_PHONE, code: '000000' });
    }

    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code });

    expect(response.status).toBe(429);
    expect(body<ErrorBody>(response).error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('rejects a code for a number that never requested one', async () => {
    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: LOCAL_PHONE, code: '123456', profile: PROFILE });

    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('OTP_EXPIRED');
  });
});

/* -------------------------------------------------------------------------- */

describe('POST /auth/refresh', () => {
  it('rotates the token, keeping the family and marking the old one replaced', async () => {
    const { tokens } = await login();

    const response = await refresh(tokens.refreshToken);
    expect(response.status).toBe(200);

    const rotated = body<{ tokens: TokenPair }>(response).tokens;
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect(rotated.accessToken).toBeTypeOf('string');

    const family = await RefreshTokenModel.find().sort({ createdAt: 1, _id: 1 }).lean().exec();
    expect(family).toHaveLength(2);
    expect(family[0]?.familyId).toBe(family[1]?.familyId);
    expect(family[0]?.replacedBy).toBe(family[1]?.tokenHash);
    expect(family[1]?.replacedBy).toBeNull();
  });

  it('rejects a correctly signed token that was never issued', async () => {
    const { user } = await login();
    // Valid signature, valid claims, no row — a token minted outside the
    // service, or one whose family was purged. The signature alone is not
    // enough; the database is the record of what exists.
    const forged = signRefreshToken(user.id).token;

    const response = await refresh(forged);
    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a tampered token', async () => {
    const { tokens } = await login();
    const response = await refresh(`${tokens.refreshToken.slice(0, -4)}AAAA`);

    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('TOKEN_INVALID');
  });

  it('rejects an access token presented as a refresh token', async () => {
    const { tokens } = await login();
    const response = await refresh(tokens.accessToken);

    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('TOKEN_INVALID');
  });
});

/* -------------------------------------------------------------------------- */

describe('refresh token lifecycle: request → verify → refresh → reuse → revocation', () => {
  it('revokes the whole family when a rotated token is replayed', async () => {
    // 1. request + 2. verify
    const { user, tokens: issued } = await login();

    // 3. refresh — the legitimate rotation.
    const rotatedResponse = await refresh(issued.refreshToken);
    expect(rotatedResponse.status).toBe(200);
    const rotated = body<{ tokens: TokenPair }>(rotatedResponse).tokens;

    // 4. reuse detection — the original token is presented a second time.
    const replay = await refresh(issued.refreshToken);
    expect(replay.status).toBe(401);
    expect(body<ErrorBody>(replay).error.code).toBe('TOKEN_REUSED');

    // 5. family revocation — the token the honest client is holding, which was
    // valid a moment ago, is now dead too. That is the point: the server
    // cannot tell the thief from the victim, so it ends the session for both.
    const afterRevocation = await refresh(rotated.refreshToken);
    expect(afterRevocation.status).toBe(401);
    expect(body<ErrorBody>(afterRevocation).error.code).toBe('TOKEN_REVOKED');

    const family = await RefreshTokenModel.find({ farmerId: user.id }).lean().exec();
    expect(family).toHaveLength(2);
    for (const token of family) {
      expect(token.revokedAt).toBeInstanceOf(Date);
    }

    // A fresh login starts a new family and is unaffected by the revocation.
    const relogin = await login();
    const newFamily = await RefreshTokenModel.find({ revokedAt: null }).lean().exec();
    expect(newFamily).toHaveLength(1);
    await expect(refresh(relogin.tokens.refreshToken)).resolves.toMatchObject({ status: 200 });
  });

  it('keeps replaying a stolen token a dead end after the family is revoked', async () => {
    const { tokens } = await login();
    const rotated = body<{ tokens: TokenPair }>(await refresh(tokens.refreshToken)).tokens;

    await refresh(tokens.refreshToken); // triggers revocation

    // Replaying the same stolen token again still reports reuse, not a
    // different error the attacker could learn from.
    const again = await refresh(tokens.refreshToken);
    expect(body<ErrorBody>(again).error.code).toBe('TOKEN_REUSED');

    const rotatedAgain = await refresh(rotated.refreshToken);
    expect(rotatedAgain.status).toBe(401);
    await expect(RefreshTokenModel.countDocuments({ revokedAt: null })).resolves.toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('GET /auth/me', () => {
  it('accepts the issued access token', async () => {
    const { user, tokens } = await login();

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(body<{ user: RequestUser }>(response).user.id).toBe(user.id);
  });

  it('rejects a missing or malformed token', async () => {
    const missing = await request(app).get('/api/v1/auth/me');
    expect(missing.status).toBe(401);
    expect(body<ErrorBody>(missing).error.code).toBe('TOKEN_INVALID');

    const malformed = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt');
    expect(malformed.status).toBe(401);
  });

  it('rejects a token whose farmer has been deactivated', async () => {
    const { user, tokens } = await login();
    await FarmerModel.updateOne({ _id: user.id }, { $set: { isActive: false } }).exec();

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(403);
    expect(body<ErrorBody>(response).error.code).toBe('ACCOUNT_INACTIVE');
  });
});
