import { z } from 'zod';

import { OTP_PURPOSES } from '@models';
import { localeCodeSchema } from '@shared/types';

/**
 * Request shapes for the auth endpoints.
 *
 * Phone numbers are only sanity-checked here; `normalisePhone` in the service
 * owns the E.164 rules, because the same normalisation has to apply to numbers
 * that arrive from places other than an HTTP body.
 */

const purposeSchema = z.enum(OTP_PURPOSES).optional();

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long');

/** Client-generated, and only ever used as a label on an issued token. */
const deviceIdSchema = z.string().trim().min(1).max(128).optional();

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: purposeSchema,
});

export type RequestOtpBody = z.infer<typeof requestOtpSchema>;

/** Sent on first login only; ignored once a farmer exists for the number. */
export const farmerProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  district: z.string().trim().min(1).max(80),
  language: localeCodeSchema.optional(),
  dsDivision: z.string().trim().min(1).max(80).optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, 'Verification code must be 4 to 10 digits'),
  purpose: purposeSchema,
  deviceId: deviceIdSchema,
  profile: farmerProfileSchema.optional(),
});

export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1, 'Refresh token is required'),
  deviceId: deviceIdSchema,
});

export type RefreshBody = z.infer<typeof refreshSchema>;
