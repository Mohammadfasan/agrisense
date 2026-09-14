import { Types } from 'mongoose';

import { FarmerModel, type Farmer } from '@models';

/**
 * Data access for `farmers`. Every query here excludes soft-deleted rows —
 * a deleted farmer must not be able to log back in by requesting a code.
 */

export interface CreateFarmerInput {
  phone: string;
  name: string;
  district: string;
  language: Farmer['language'];
  role?: Farmer['role'];
  dsDivision?: string;
}

const NOT_DELETED = { deletedAt: null } as const;

export async function findByPhone(phone: string): Promise<Farmer | null> {
  return FarmerModel.findOne({ phone, ...NOT_DELETED })
    .lean<Farmer>()
    .exec();
}

export async function findById(id: string): Promise<Farmer | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }
  return FarmerModel.findOne({ _id: id, ...NOT_DELETED })
    .lean<Farmer>()
    .exec();
}

export async function create(input: CreateFarmerInput): Promise<Farmer> {
  const created = await FarmerModel.create({
    ...input,
    role: input.role ?? 'farmer',
    // Reaching this point means an OTP for the number was just verified.
    isVerified: true,
    isActive: true,
    lastLoginAt: new Date(),
  });
  return created.toObject<Farmer>();
}

/**
 * Records a successful login and, for a farmer created before verification
 * existed, flips `isVerified`. Returns the updated row so the caller does not
 * have to re-read it.
 */
export async function markLoggedIn(id: Types.ObjectId): Promise<Farmer | null> {
  return FarmerModel.findOneAndUpdate(
    { _id: id, ...NOT_DELETED },
    { $set: { lastLoginAt: new Date(), isVerified: true } },
    { new: true },
  )
    .lean<Farmer>()
    .exec();
}
