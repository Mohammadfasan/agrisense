import type { Types } from 'mongoose';

import { RefreshTokenModel, type RefreshToken } from '@models';

/**
 * Data access for `refreshTokens`, including the rotation bookkeeping that
 * reuse detection depends on.
 */

export interface CreateRefreshTokenInput {
  farmerId: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  deviceId?: string;
}

export async function create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
  const created = await RefreshTokenModel.create({ ...input, revokedAt: null, replacedBy: null });
  return created.toObject<RefreshToken>();
}

export async function findByHash(tokenHash: string): Promise<RefreshToken | null> {
  return RefreshTokenModel.findOne({ tokenHash }).lean<RefreshToken>().exec();
}

/**
 * Stamps the presented token as superseded.
 *
 * The `replacedBy: null` guard makes rotation itself atomic: if two refreshes
 * race on the same token, exactly one stamps it and the other sees `false` —
 * which is the same signal a replay produces, and is treated the same way.
 */
export async function markRotated(tokenHash: string, replacedBy: string): Promise<boolean> {
  const result = await RefreshTokenModel.updateOne(
    { tokenHash, replacedBy: null, revokedAt: null },
    { $set: { replacedBy } },
  ).exec();
  return result.modifiedCount === 1;
}

/**
 * Revokes every token in a lineage — the response to a replayed token.
 *
 * Rotated ancestors are revoked too, not just the live leaf: the point is to
 * end the whole session, and leaving `revokedAt` unset on the ancestors would
 * lose the record of when that happened.
 */
export async function revokeFamily(farmerId: Types.ObjectId, familyId: string): Promise<number> {
  const result = await RefreshTokenModel.updateMany(
    { farmerId, familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  ).exec();
  return result.modifiedCount;
}

/** Every token in a lineage, newest first. Used by tests and by support tooling. */
export async function findFamily(
  farmerId: Types.ObjectId,
  familyId: string,
): Promise<RefreshToken[]> {
  return RefreshTokenModel.find({ farmerId, familyId })
    .sort({ createdAt: -1 })
    .lean<RefreshToken[]>()
    .exec();
}
