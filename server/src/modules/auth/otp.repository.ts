import { OtpModel, type Otp, type OtpPurpose } from '@models';
import type { Types } from 'mongoose';

/**
 * Data access for `otps`. The mutating helpers are single atomic updates
 * rather than read-modify-write, so two verifications racing on the same code
 * cannot both win.
 */

export interface CreateOtpInput {
  phone: string;
  codeHash: string;
  purpose: OtpPurpose;
  expiresAt: Date;
}

export async function create(input: CreateOtpInput): Promise<Otp> {
  const created = await OtpModel.create({ ...input, attempts: 0, consumedAt: null });
  return created.toObject<Otp>();
}

/** How many codes have been issued for this phone since `since` — rate limiting. */
export async function countIssuedSince(
  phone: string,
  purpose: OtpPurpose,
  since: Date,
): Promise<number> {
  return OtpModel.countDocuments({ phone, purpose, createdAt: { $gte: since } }).exec();
}

/** The oldest still-issued code for the phone, used to compute a retry-after. */
export async function findOldestIssuedSince(
  phone: string,
  purpose: OtpPurpose,
  since: Date,
): Promise<Otp | null> {
  return OtpModel.findOne({ phone, purpose, createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .lean<Otp>()
    .exec();
}

/**
 * The code a verification should be checked against: the most recent one that
 * is unconsumed and unexpired. Requesting a new code therefore supersedes the
 * previous one in practice, without a separate invalidation write.
 */
export async function findActive(
  phone: string,
  purpose: OtpPurpose,
  now: Date = new Date(),
): Promise<Otp | null> {
  return OtpModel.findOne({ phone, purpose, consumedAt: null, expiresAt: { $gt: now } })
    .sort({ createdAt: -1 })
    .lean<Otp>()
    .exec();
}

/** Returns the new attempt count so the caller can compare it to the ceiling. */
export async function incrementAttempts(id: Types.ObjectId): Promise<number> {
  const updated = await OtpModel.findByIdAndUpdate(id, { $inc: { attempts: 1 } }, { new: true })
    .lean<Otp>()
    .exec();
  return updated?.attempts ?? 0;
}

/**
 * Burns the code. The `consumedAt: null` guard is what makes single use real:
 * only one concurrent caller can transition the document, and `false` tells
 * the loser it lost.
 */
export async function consume(id: Types.ObjectId): Promise<boolean> {
  const result = await OtpModel.updateOne(
    { _id: id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  ).exec();
  return result.modifiedCount === 1;
}
