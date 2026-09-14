import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

/**
 * `refreshTokens` — one row per issued refresh token (see `docs/schema.md` §3).
 *
 * Rotation and reuse detection: each refresh issues a new token and stamps the
 * old one with `replacedBy`. A token that already carries `replacedBy` being
 * presented again means it was replayed — a legitimate client never does that
 * — so the whole `familyId` is revoked.
 */

export interface RefreshToken {
  _id: Types.ObjectId;
  farmerId: Types.ObjectId;
  /** SHA-256 of the token. The raw token exists only on the wire. */
  tokenHash: string;
  /** Shared by every token descended from one login; the unit of revocation. */
  familyId: string;
  deviceId?: string;
  revokedAt?: Date | null;
  /** `tokenHash` of the token that superseded this one. */
  replacedBy?: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

const refreshTokenSchema = new Schema<RefreshToken>(
  {
    farmerId: { type: Schema.Types.ObjectId, ref: 'Farmer', required: true },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    deviceId: { type: String, trim: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'refreshtokens' },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' });
refreshTokenSchema.index({ farmerId: 1, familyId: 1 }, { name: 'farmer_family' });
// An expired token is useless to both the client and to reuse detection, so it
// can go the moment it lapses.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

export const RefreshTokenModel: Model<RefreshToken> = model<RefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);
