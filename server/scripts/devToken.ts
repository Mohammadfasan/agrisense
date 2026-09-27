import mongoose from 'mongoose';

import { env } from '@config';
import { FarmerModel, type Farmer } from '@models';

import { signAccessToken } from '../src/modules/auth/token.service';

const TEST_PHONE = '+94770000001';

async function main(): Promise<void> {
  if (env.isProduction) {
    throw new Error('devToken must never run in production');
  }

  await mongoose.connect(env.MONGODB_URI);

  const farmer = await FarmerModel.findOneAndUpdate(
    { phone: TEST_PHONE },
    {
      $setOnInsert: {
        phone: TEST_PHONE,
        name: 'E2E Test Farmer',
        role: 'farmer',
        language: 'ta',
        district: 'Anuradhapura',
        isVerified: true,
      },
    },
    { upsert: true, new: true },
  )
    .lean<Farmer>()
    .exec();

  // Only the token on stdout, so a shell can capture it into a variable.
  process.stdout.write(
    signAccessToken({ sub: farmer._id.toString(), role: farmer.role, district: farmer.district }),
  );
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
