import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app';
import {
  FarmerModel,
  FarmerProfileModel,
  type Farmer,
  type FarmerProfile,
  type FarmerRole,
} from '@models';

import { body } from '../../test/http';

import { signAccessToken } from '../auth/token.service';

/**
 * End-to-end coverage of `/farmers/me` against a real MongoDB.
 *
 * The parts of this feature that can actually go wrong are all at the
 * boundaries a stubbed service would skip: the unique index behind "one
 * profile per farmer", whether a replace keeps `createdAt`, and whether a
 * `userId` in the body reaches the database. So the tests go through Express
 * and out to the collection.
 */

const app = createApp();

interface ProfileBody {
  profile: FarmerProfile;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Anuradhapura, roughly -- inside the districts the enum admits. */
const LOCATION = { type: 'Point' as const, coordinates: [80.4037, 8.3114] };

const FULL_PROFILE = {
  fullName: 'Nimal Perera',
  district: 'Anuradhapura',
  gnDivision: 'Thambuttegama North',
  location: LOCATION,
  landSizeAcres: 2.5,
  primaryCrops: ['PADDY', 'CHILLI'],
  preferredLanguage: 'si',
};

interface SeedOptions {
  role?: FarmerRole;
  language?: 'ta' | 'si' | 'en';
}

async function seedFarmer(options: SeedOptions = {}): Promise<{ farmer: Farmer; token: string }> {
  const created = await FarmerModel.create({
    phone: `+9477${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    name: 'Test User',
    role: options.role ?? 'farmer',
    language: options.language ?? 'en',
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

function authed(method: 'get' | 'put' | 'patch', token: string): request.Test {
  return request(app)[method]('/api/v1/farmers/me').set('Authorization', `Bearer ${token}`);
}

/* -------------------------------------------------------------------------- */

describe('GET /farmers/me', () => {
  it('answers 404 PROFILE_NOT_FOUND when the farmer has not filled one in', async () => {
    const { token } = await seedFarmer();

    const response = await authed('get', token);

    expect(response.status).toBe(404);
    // Not a bare NOT_FOUND: the client opens the profile form on this code,
    // and a mistyped URL must not trigger that.
    expect(body<ErrorBody>(response).error.code).toBe('PROFILE_NOT_FOUND');
  });

  it('requires a token', async () => {
    const response = await request(app).get('/api/v1/farmers/me');
    expect(response.status).toBe(401);
  });
});

describe('PUT /farmers/me', () => {
  it('creates the profile with 201, and GET then returns it', async () => {
    const { token } = await seedFarmer();

    const created = await authed('put', token).send(FULL_PROFILE);

    expect(created.status).toBe(201);
    const saved = body<ProfileBody>(created).profile;
    expect(saved.fullName).toBe('Nimal Perera');
    expect(saved.landSizeAcres).toBe(2.5);
    expect(saved.primaryCrops).toEqual(['PADDY', 'CHILLI']);
    expect(saved.location.coordinates).toEqual([80.4037, 8.3114]);

    const fetched = await authed('get', token);
    expect(fetched.status).toBe(200);
    expect(body<ProfileBody>(fetched).profile.gnDivision).toBe('Thambuttegama North');
  });

  it('replaces on a second PUT with 200, and keeps one row per farmer', async () => {
    const { farmer, token } = await seedFarmer();
    await authed('put', token).send(FULL_PROFILE);

    const replaced = await authed('put', token).send({
      ...FULL_PROFILE,
      fullName: 'Nimal K. Perera',
      district: 'Polonnaruwa',
      landSizeAcres: 4,
      primaryCrops: ['TOMATO'],
    });

    expect(replaced.status).toBe(200);
    const profile = body<ProfileBody>(replaced).profile;
    expect(profile.fullName).toBe('Nimal K. Perera');
    expect(profile.district).toBe('Polonnaruwa');
    expect(profile.primaryCrops).toEqual(['TOMATO']);

    // The unique index is what is being checked here, not the number itself.
    await expect(FarmerProfileModel.countDocuments({ userId: farmer._id })).resolves.toBe(1);
  });

  it('keeps the original createdAt across a replace', async () => {
    const { token } = await seedFarmer();
    const created = await authed('put', token).send(FULL_PROFILE);
    const firstCreatedAt = body<ProfileBody>(created).profile.createdAt;

    const replaced = await authed('put', token).send({ ...FULL_PROFILE, landSizeAcres: 9 });

    // A `findOneAndReplace` would have stamped a new one; `$set` does not.
    expect(body<ProfileBody>(replaced).profile.createdAt).toBe(firstCreatedAt);
  });

  it('falls back to the language on the farmer record when the body omits one', async () => {
    const { token } = await seedFarmer({ language: 'ta' });
    const { preferredLanguage: _omitted, ...withoutLanguage } = FULL_PROFILE;

    const response = await authed('put', token).send(withoutLanguage);

    expect(response.status).toBe(201);
    expect(body<ProfileBody>(response).profile.preferredLanguage).toBe('ta');
  });

  it('writes fullName, district and language through to the farmer record', async () => {
    const { farmer, token } = await seedFarmer({ language: 'en' });

    await authed('put', token).send(FULL_PROFILE);

    // Officer scoping and /auth/me read these fields, not the profile.
    const updated = await FarmerModel.findById(farmer._id).lean<Farmer>().exec();
    expect(updated?.name).toBe('Nimal Perera');
    expect(updated?.district).toBe('Anuradhapura');
    expect(updated?.language).toBe('si');
  });

  it('rejects a full body that is missing a required field', async () => {
    const { token } = await seedFarmer();
    const { gnDivision: _missing, ...incomplete } = FULL_PROFILE;

    const response = await authed('put', token).send(incomplete);

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /farmers/me', () => {
  it('updates one field and leaves the rest alone', async () => {
    const { token } = await seedFarmer();
    await authed('put', token).send(FULL_PROFILE);

    const response = await authed('patch', token).send({ landSizeAcres: 7.25 });

    expect(response.status).toBe(200);
    const profile = body<ProfileBody>(response).profile;
    expect(profile.landSizeAcres).toBe(7.25);
    expect(profile.fullName).toBe('Nimal Perera');
    expect(profile.district).toBe('Anuradhapura');
    expect(profile.gnDivision).toBe('Thambuttegama North');
    expect(profile.primaryCrops).toEqual(['PADDY', 'CHILLI']);
    expect(profile.location.coordinates).toEqual([80.4037, 8.3114]);
    expect(profile.preferredLanguage).toBe('si');
  });

  it('answers 404 PROFILE_NOT_FOUND rather than creating one', async () => {
    const { farmer, token } = await seedFarmer();

    const response = await authed('patch', token).send({ landSizeAcres: 3 });

    expect(response.status).toBe(404);
    expect(body<ErrorBody>(response).error.code).toBe('PROFILE_NOT_FOUND');
    await expect(FarmerProfileModel.countDocuments({ userId: farmer._id })).resolves.toBe(0);
  });
});

describe('validation', () => {
  it.each([
    ['longitude past 180', [181, 8.3114]],
    ['latitude past 90', [80.4037, 91]],
    ['bounds swapped by a transposed pair', [8.3114, 180.4037]],
    ['a third element', [80.4037, 8.3114, 100]],
    ['a single element', [80.4037]],
  ])('rejects coordinates with %s as 422', async (_label, coordinates) => {
    const { token } = await seedFarmer();

    const response = await authed('put', token).send({
      ...FULL_PROFILE,
      location: { type: 'Point', coordinates },
    });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['a district outside the three', { district: 'Colombo' }],
    ['an unsupported crop', { primaryCrops: ['DURIAN'] }],
    ['an empty crop list', { primaryCrops: [] }],
    ['land below the floor', { landSizeAcres: 0.05 }],
    ['land above the ceiling', { landSizeAcres: 1001 }],
    ['a one-character name', { fullName: 'A' }],
    ['a name that is only whitespace', { fullName: '   ' }],
  ])('rejects %s as 422', async (_label, patch) => {
    const { token } = await seedFarmer();

    const response = await authed('put', token).send({ ...FULL_PROFILE, ...patch });

    expect(response.status).toBe(422);
    expect(body<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('de-duplicates a repeated crop rather than storing it twice', async () => {
    const { token } = await seedFarmer();

    const response = await authed('put', token).send({
      ...FULL_PROFILE,
      primaryCrops: ['PADDY', 'PADDY', 'ONION'],
    });

    expect(response.status).toBe(201);
    expect(body<ProfileBody>(response).profile.primaryCrops).toEqual(['PADDY', 'ONION']);
  });
});

describe('authorisation', () => {
  it.each<FarmerRole>(['officer', 'market_admin', 'admin'])(
    'refuses role %s with 403',
    async (role) => {
      const { token } = await seedFarmer({ role });

      const response = await authed('get', token);

      expect(response.status).toBe(403);
      expect(body<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    },
  );

  it('refuses a non-farmer write without creating anything', async () => {
    const { farmer, token } = await seedFarmer({ role: 'officer' });

    const response = await authed('put', token).send(FULL_PROFILE);

    expect(response.status).toBe(403);
    await expect(FarmerProfileModel.countDocuments({ userId: farmer._id })).resolves.toBe(0);
  });
});

describe('geospatial', () => {
  it('finds a saved profile through a proximity query', async () => {
    const { token } = await seedFarmer();
    await authed('put', token).send(FULL_PROFILE);

    // What the 2dsphere index is actually for (Week 9 outbreak clustering).
    // Asserting the index exists proves it was declared; running a query
    // through it proves the coordinates were stored in a shape it can read --
    // the wrong nesting, or numbers arriving as strings, both pass a
    // declaration check and fail here.
    const near = await FarmerProfileModel.find({
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [80.41, 8.31] },
          $maxDistance: 5_000,
        },
      },
    })
      .lean<FarmerProfile[]>()
      .exec();

    expect(near).toHaveLength(1);
    expect(near[0]?.gnDivision).toBe('Thambuttegama North');

    // Colombo, ~150km away and well outside the radius. A `find` rather than
    // a `countDocuments`: the latter runs as an aggregation, and `$nearSphere`
    // is rejected there because it has no sort stage to order by.
    const far = await FarmerProfileModel.find({
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [79.86, 6.93] },
          $maxDistance: 5_000,
        },
      },
    })
      .lean<FarmerProfile[]>()
      .exec();

    expect(far).toHaveLength(0);
  });
});

describe('ownership', () => {
  it('ignores a userId in the body and writes the caller instead', async () => {
    const { farmer: caller, token } = await seedFarmer();
    const { farmer: victim } = await seedFarmer();

    const response = await authed('put', token).send({
      ...FULL_PROFILE,
      userId: victim._id.toString(),
      _id: victim._id.toString(),
    });

    expect(response.status).toBe(201);
    // The row landed on the caller, and the farmer they named has nothing.
    expect(String(body<ProfileBody>(response).profile.userId)).toBe(caller._id.toString());
    await expect(FarmerProfileModel.countDocuments({ userId: caller._id })).resolves.toBe(1);
    await expect(FarmerProfileModel.countDocuments({ userId: victim._id })).resolves.toBe(0);
  });

  it('cannot write another farmer profile through PUT', async () => {
    const { farmer: victim, token: victimToken } = await seedFarmer();
    await authed('put', victimToken).send(FULL_PROFILE);

    const { token: otherToken } = await seedFarmer();
    await authed('put', otherToken).send({
      ...FULL_PROFILE,
      userId: victim._id.toString(),
      fullName: 'Overwritten',
      landSizeAcres: 999,
    });

    // Their row is untouched; the caller got one of their own instead.
    const theirs = await FarmerProfileModel.findOne({ userId: victim._id })
      .lean<FarmerProfile>()
      .exec();
    expect(theirs?.fullName).toBe('Nimal Perera');
    expect(theirs?.landSizeAcres).toBe(2.5);
  });

  it('cannot write another farmer profile through PATCH', async () => {
    const { farmer: victim, token: victimToken } = await seedFarmer();
    await authed('put', victimToken).send(FULL_PROFILE);

    const { farmer: other, token: otherToken } = await seedFarmer();
    const response = await authed('patch', otherToken).send({
      userId: victim._id.toString(),
      fullName: 'Overwritten',
    });

    // The caller has no profile, so their own PATCH 404s -- the userId they
    // put in the body did not select someone else's row for them to edit.
    expect(response.status).toBe(404);
    expect(body<ErrorBody>(response).error.code).toBe('PROFILE_NOT_FOUND');

    const theirs = await FarmerProfileModel.findOne({ userId: victim._id })
      .lean<FarmerProfile>()
      .exec();
    expect(theirs?.fullName).toBe('Nimal Perera');
    await expect(FarmerProfileModel.countDocuments({ userId: other._id })).resolves.toBe(0);
  });

  it('keeps two farmers profiles independent', async () => {
    const { token: first } = await seedFarmer();
    const { token: second } = await seedFarmer();

    await authed('put', first).send(FULL_PROFILE);
    await authed('put', second).send({ ...FULL_PROFILE, fullName: 'Kamala Silva' });

    expect(body<ProfileBody>(await authed('get', first)).profile.fullName).toBe('Nimal Perera');
    expect(body<ProfileBody>(await authed('get', second)).profile.fullName).toBe('Kamala Silva');
  });
});
