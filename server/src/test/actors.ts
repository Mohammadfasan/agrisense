import { FarmerModel, type Farmer } from '@models';

import { signAccessToken } from '../modules/auth/token.service';

/**
 * A verified farmer and a token for them.
 *
 * Extracted from `calendar.integration.test` when a second calendar test file
 * needed the same three lines. Every integration test that touches an
 * owner-scoped route needs one of these, and two files disagreeing about what
 * a valid actor looks like is how a security assertion quietly stops asserting
 * anything.
 */
export interface Actor {
  farmer: Farmer;
  token: string;
}

/**
 * The phone number is randomised because `farmers.phone` is uniquely indexed
 * and tests within a file share a database.
 */
export async function seedFarmer(): Promise<Actor> {
  const created = await FarmerModel.create({
    phone: `+9477${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    name: 'Test User',
    role: 'farmer',
    language: 'en',
    district: 'Anuradhapura',
    isVerified: true,
  });
  const farmer = created.toObject<Farmer>();

  return {
    farmer,
    token: signAccessToken({
      sub: farmer._id.toString(),
      role: farmer.role,
      district: farmer.district,
    }),
  };
}
