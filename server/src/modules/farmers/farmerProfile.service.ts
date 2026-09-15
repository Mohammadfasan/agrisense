import { Types } from 'mongoose';

import { FarmerModel, FarmerProfileModel, type FarmerProfile } from '@models';
import {
  AppError,
  ErrorCode,
  HttpStatus,
  type FarmerProfileInput,
  type FarmerProfileUpdateInput,
  type LocaleCode,
} from '@shared';

/**
 * Farmer profile reads and writes.
 *
 * The owner is a parameter of every function here and is never read out of a
 * payload: callers pass the id from `req.user`, so there is no path through
 * this module by which a request could name a profile other than its own.
 *
 * Writes also keep `farmers` in step -- see {@link writeThrough}.
 */

export interface SaveResult {
  profile: FarmerProfile;
  /** `true` when this call created the profile, for the 201/200 decision. */
  created: boolean;
}

export async function getByUserId(userId: string): Promise<FarmerProfile> {
  const profile = await FarmerProfileModel.findOne({ userId: toObjectId(userId) })
    .lean<FarmerProfile>()
    .exec();

  if (!profile) {
    throw profileNotFound();
  }
  return profile;
}

/**
 * Creates the profile, or replaces it wholesale if one exists.
 *
 * A replace, not a merge: `PUT` is defined on the whole resource, so a field
 * left out of the body is meant to go back to its default rather than keep the
 * value it had. `farmerProfileSchema` requires every field but
 * `preferredLanguage`, whose default is the language on the farmer record.
 *
 * Expressed as `$set` over the full field list rather than as a
 * `findOneAndReplace`, which would take `createdAt` with it: a replacement
 * document carries no timestamps, so Mongoose would stamp a new creation date
 * onto a profile that has existed for months. One upsert either way, so the
 * only difference is the one that matters.
 */
export async function replace(
  userId: string,
  input: FarmerProfileInput,
  fallbackLanguage: LocaleCode,
): Promise<SaveResult> {
  const owner = toObjectId(userId);

  const result = await FarmerProfileModel.findOneAndUpdate(
    { userId: owner },
    {
      $set: { ...input, preferredLanguage: input.preferredLanguage ?? fallbackLanguage },
      $setOnInsert: { userId: owner },
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      // Carries `lastErrorObject.upserted`, which is how a create is told from
      // a replace without a second query.
      includeResultMetadata: true,
      lean: true,
    },
  ).exec();

  const profile = expectWritten(result.value);
  await writeThrough(owner, profile);

  return { profile, created: result.lastErrorObject?.upserted !== undefined };
}

/**
 * Merges a partial body into an existing profile. Absent fields are left
 * alone, which is the whole difference from {@link replace}.
 *
 * Never upserts: a `PATCH` names fields of a resource that is supposed to
 * exist, and creating one from a fragment would leave required fields unset.
 */
export async function update(
  userId: string,
  patch: FarmerProfileUpdateInput,
): Promise<FarmerProfile> {
  const owner = toObjectId(userId);

  // The patch goes in as-is: Zod has already stripped everything not in the
  // schema, so no unknown path and no `$` operator survives to reach here.
  const profile = await FarmerProfileModel.findOneAndUpdate(
    { userId: owner },
    { $set: patch },
    { new: true, runValidators: true },
  )
    .lean<FarmerProfile>()
    .exec();

  if (!profile) {
    throw profileNotFound();
  }

  await writeThrough(owner, profile);
  return profile;
}

/**
 * Copies the three shared fields onto the farmer record.
 *
 * `authenticate` rebuilds `req.user` from `farmers` on every request, and
 * officer scoping keys off `farmers.district` (`auth.middleware`'s
 * `buildScope`). Without this, a farmer who corrected their district in their
 * profile would go on being scoped, and advised, by the old one.
 *
 * Two writes rather than a transaction: the in-memory MongoDB the tests run
 * against is a standalone and has none, and the state this would guard
 * against -- a profile saved, the farmer record left stale -- is repaired by
 * the next successful save.
 */
async function writeThrough(userId: Types.ObjectId, profile: FarmerProfile): Promise<void> {
  await FarmerModel.updateOne(
    { _id: userId },
    {
      $set: {
        name: profile.fullName,
        district: profile.district,
        language: profile.preferredLanguage,
      },
    },
  ).exec();
}

function profileNotFound(): AppError {
  return new AppError('No farmer profile exists for this account', HttpStatus.NOT_FOUND, {
    code: ErrorCode.PROFILE_NOT_FOUND,
  });
}

/**
 * An upsert that reports neither a document nor an error has no benign
 * reading, so it fails loudly rather than returning a half-saved profile.
 */
function expectWritten(value: FarmerProfile | null): FarmerProfile {
  if (!value) {
    throw AppError.internal('Profile upsert returned no document');
  }
  return value;
}

/**
 * `req.user.id` is a string that came off a verified token and was then used
 * to load a real farmer, so it is well-formed by the time it reaches here. A
 * malformed one is a defect upstream, not a bad request.
 */
function toObjectId(userId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(userId)) {
    throw AppError.internal('Authenticated user id is not an ObjectId');
  }
  return new Types.ObjectId(userId);
}
