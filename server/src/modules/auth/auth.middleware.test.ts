import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { FarmerModel, type Farmer, type FarmerRole } from '@models';
import { errorHandler, requestId } from '@shared';

import { body } from '../../test/http';

import { authenticate, authorise, scopeToDistrict } from './auth.middleware';
import { signAccessToken } from './token.service';

/**
 * The middleware trio, mounted on a throwaway app so each one can be exercised
 * in isolation — including the combinations no real route has yet.
 */

interface ErrorBody {
  error: { code: string; message: string };
}

/** An app whose routes do nothing but report what the middleware produced. */
function buildApp(): Express {
  const app = express();
  app.use(requestId);
  app.use(express.json());

  app.get('/officers-only', authenticate, authorise('officer', 'admin'), (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/scoped', authenticate, scopeToDistrict(), (req: Request, res: Response) => {
    res.json({
      districts: req.scope?.districts,
      unrestricted: req.scope?.unrestricted,
      filter: req.scope?.apply({ deletedAt: null }),
    });
  });

  // A handler that already pinned a district — the scope must narrow it, not
  // be overwritten by it.
  app.get('/scoped-preset', authenticate, scopeToDistrict(), (req: Request, res: Response) => {
    res.json({ filter: req.scope?.apply({ district: 'Colombo' }) });
  });

  // Scoping a field that is not called `district`.
  app.get('/scoped-field', authenticate, scopeToDistrict({ field: 'homeDistrict' }), (req, res) => {
    res.json({ filter: req.scope?.filter() });
  });

  // Deliberately mis-wired: no `authenticate` in front of it.
  app.get('/unwired', scopeToDistrict(), (_req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);
  return app;
}

const app = buildApp();

interface SeedOptions {
  role?: FarmerRole;
  district?: string;
  assignedDistricts?: string[];
}

async function seedFarmer(options: SeedOptions = {}): Promise<{ farmer: Farmer; token: string }> {
  const created = await FarmerModel.create({
    phone: `+9477${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    name: 'Test User',
    role: options.role ?? 'farmer',
    language: 'en',
    district: options.district ?? 'Kandy',
    assignedDistricts: options.assignedDistricts ?? [],
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

function get(path: string, token?: string): request.Test {
  const call = request(app).get(path);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

/* -------------------------------------------------------------------------- */

describe('authenticate', () => {
  it('attaches the current farmer, not the claims baked into the token', async () => {
    const { farmer, token } = await seedFarmer({ district: 'Kandy' });
    // The token still says Kandy; the record now says Jaffna.
    await FarmerModel.updateOne({ _id: farmer._id }, { $set: { district: 'Jaffna' } }).exec();

    const response = await get('/scoped', token);

    expect(response.status).toBe(200);
    expect(body<{ districts: string[] }>(response).districts).toEqual(['Jaffna']);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { token } = await seedFarmer();
    const tampered = `${token.slice(0, -4)}AAAA`;

    const response = await get('/scoped', tampered);
    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token for a farmer who has since been soft-deleted', async () => {
    const { farmer, token } = await seedFarmer();
    await FarmerModel.updateOne({ _id: farmer._id }, { $set: { deletedAt: new Date() } }).exec();

    const response = await get('/scoped', token);
    expect(response.status).toBe(401);
    expect(body<ErrorBody>(response).error.code).toBe('TOKEN_INVALID');
  });
});

/* -------------------------------------------------------------------------- */

describe('authorise', () => {
  it('admits a role on the list', async () => {
    const { token } = await seedFarmer({ role: 'officer' });
    await expect(get('/officers-only', token)).resolves.toMatchObject({ status: 200 });
  });

  it('refuses a role that is not', async () => {
    const { token } = await seedFarmer({ role: 'farmer' });

    const response = await get('/officers-only', token);
    expect(response.status).toBe(403);
    expect(body<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('refuses an unauthenticated caller before it reaches the role check', async () => {
    await expect(get('/officers-only')).resolves.toMatchObject({ status: 401 });
  });
});

/* -------------------------------------------------------------------------- */

describe('scopeToDistrict', () => {
  it('limits a farmer to their own district', async () => {
    const { token } = await seedFarmer({ district: 'Matara' });

    const response = await get('/scoped', token);
    expect(body<{ filter: unknown }>(response).filter).toEqual({
      deletedAt: null,
      district: { $in: ['Matara'] },
    });
  });

  it('gives an officer their home district plus everything assigned to them', async () => {
    const { token } = await seedFarmer({
      role: 'officer',
      district: 'Kandy',
      // Kandy repeated on purpose: the scope must not produce duplicates.
      assignedDistricts: ['Matale', 'Kandy', 'Nuwara Eliya'],
    });

    const response = await get('/scoped', token);
    const payload = body<{ districts: string[]; unrestricted: boolean }>(response);

    expect(payload.districts).toEqual(['Kandy', 'Matale', 'Nuwara Eliya']);
    expect(payload.unrestricted).toBe(false);
  });

  it('ignores assignedDistricts for a non-officer who somehow has them', async () => {
    const { token } = await seedFarmer({ role: 'farmer', assignedDistricts: ['Galle'] });

    const response = await get('/scoped', token);
    expect(body<{ districts: string[] }>(response).districts).toEqual(['Kandy']);
  });

  it('leaves an admin unrestricted', async () => {
    const { token } = await seedFarmer({ role: 'admin' });

    const response = await get('/scoped', token);
    const payload = body<{ districts: null; unrestricted: boolean; filter: unknown }>(response);

    expect(payload.districts).toBeNull();
    expect(payload.unrestricted).toBe(true);
    expect(payload.filter).toEqual({ deletedAt: null });
  });

  it('narrows a district the handler already chose instead of replacing it', async () => {
    const { token } = await seedFarmer({ district: 'Matara' });

    const response = await get('/scoped-preset', token);
    // Colombo AND in-scope — which matches nothing, and that is correct: the
    // caller may not read Colombo.
    expect(body<{ filter: unknown }>(response).filter).toEqual({
      district: 'Colombo',
      $and: [{ district: { $in: ['Matara'] } }],
    });
  });

  it('scopes a differently named field on request', async () => {
    const { token } = await seedFarmer({ district: 'Galle' });

    const response = await get('/scoped-field', token);
    expect(body<{ filter: unknown }>(response).filter).toEqual({
      homeDistrict: { $in: ['Galle'] },
    });
  });

  it('fails loudly when mounted without authenticate', async () => {
    const response = await get('/unwired');

    // A 401 here would hide a routing bug behind a plausible-looking response.
    expect(response.status).toBe(500);
    expect(body<ErrorBody>(response).error.code).toBe('INTERNAL_ERROR');
  });
});
