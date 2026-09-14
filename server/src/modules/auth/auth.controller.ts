import type { Request, Response } from 'express';

import { HttpStatus, parseOrThrow } from '@shared';

import * as authService from './auth.service';
import { refreshSchema, requestOtpSchema, verifyOtpSchema } from './auth.schemas';

/**
 * HTTP adapters for the auth use cases: validate the body, call the service,
 * shape the response. No branching on domain rules lives here.
 *
 * Optional fields are spread conditionally rather than passed as `undefined`
 * — `exactOptionalPropertyTypes` draws a real distinction between "absent"
 * and "explicitly undefined", and the service signatures mean absent.
 */

/** POST /auth/otp/request */
export async function requestOtp(req: Request, res: Response): Promise<void> {
  const body = parseOrThrow(requestOtpSchema, req.body, 'OTP request');

  const result = await authService.requestOtp({
    phone: body.phone,
    ...(body.purpose === undefined ? {} : { purpose: body.purpose }),
  });

  res.status(HttpStatus.OK).json({
    phone: result.phone,
    expiresAt: result.expiresAt.toISOString(),
    expiresInSeconds: result.expiresInSeconds,
    requestsRemaining: result.requestsRemaining,
    ...(result.devCode === undefined ? {} : { devCode: result.devCode }),
  });
}

/** POST /auth/otp/verify */
export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const body = parseOrThrow(verifyOtpSchema, req.body, 'OTP verification');

  const result = await authService.verifyOtp({
    phone: body.phone,
    code: body.code,
    ...(body.purpose === undefined ? {} : { purpose: body.purpose }),
    ...(body.deviceId === undefined ? {} : { deviceId: body.deviceId }),
    ...(body.profile === undefined
      ? {}
      : {
          profile: {
            name: body.profile.name,
            district: body.profile.district,
            ...(body.profile.language === undefined ? {} : { language: body.profile.language }),
            ...(body.profile.dsDivision === undefined
              ? {}
              : { dsDivision: body.profile.dsDivision }),
          },
        }),
  });

  res.status(HttpStatus.OK).json(result);
}

/** POST /auth/refresh */
export async function refresh(req: Request, res: Response): Promise<void> {
  const body = parseOrThrow(refreshSchema, req.body, 'refresh request');

  const tokens = await authService.refresh({
    refreshToken: body.refreshToken,
    ...(body.deviceId === undefined ? {} : { deviceId: body.deviceId }),
  });

  res.status(HttpStatus.OK).json({ tokens });
}

/** GET /auth/me — the caller as the server currently sees them. */
export function me(req: Request, res: Response): void {
  res.status(HttpStatus.OK).json({ user: req.user });
}
