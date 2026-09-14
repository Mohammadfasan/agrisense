import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { env } from '@config';

/**
 * `otps` — short-lived verification codes (see `docs/schema.md` §2).
 *
 * Kept out of `farmers` so expiry is a whole-document TTL rather than
 * field-level cleanup, and so a code can be issued for a phone that has no
 * farmer record yet (first-time sign-up).
 */

export const OTP_PURPOSES = ['login', 'phone_change'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export interface Otp {
  _id: Types.ObjectId;
  phone: string;
  /** bcrypt digest — the code itself is never stored, logged or returned. */
  codeHash: string;
  purpose: OtpPurpose;
  /** Incremented on every failed comparison; burns the code at the ceiling. */
  attempts: number;
  /** Set exactly once, by the verification that succeeds. */
  consumedAt?: Date | null;
  /** When the code stops being accepted. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type OtpDocument = HydratedDocument<Otp>;

const otpSchema = new Schema<Otp>(
  {
    phone: { type: String, required: true, trim: true },
    codeHash: { type: String, required: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true, default: 'login' },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'otps' },
);

otpSchema.index({ phone: 1, purpose: 1 }, { name: 'phone_purpose' });

/**
 * TTL purge.
 *
 * `expireAfterSeconds` is the request-rate window rather than `0`, so a
 * document survives its own `expiresAt` by one window. Per-phone rate limiting
 * counts issued codes over that window (`OTP_MAX_REQUESTS_PER_WINDOW` per
 * hour); with an immediate purge the codes would be gone minutes after issue
 * and the limit would silently count almost nothing. `expiresAt` still means
 * exactly what it says — when the code stops working — it just is not also the
 * moment the row disappears.
 */
otpSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: env.OTP_REQUEST_WINDOW_SECONDS, name: 'expires_ttl' },
);

export const OtpModel: Model<Otp> = model<Otp>('Otp', otpSchema);
