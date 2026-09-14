import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Load `.env` from the server package root before anything reads `process.env`.
 * Real environment variables always win over the file (dotenv never overrides).
 */
const envFile = path.resolve(__dirname, '../../.env');
if (existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

/** Coerce a `"1mb"`-style or numeric string, keeping it a string for Express. */
const bodyLimit = z.string().regex(/^\d+(\.\d+)?(b|kb|mb|gb)?$/i, 'must be a size like "1mb"');

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_PRETTY: booleanish.optional(),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'must start with mongodb:// or mongodb+srv://',
    ),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  REDIS_URL: z.string().startsWith('redis').optional(),

  CORS_ORIGIN: z.string().default('*'),
  BODY_LIMIT: bodyLimit.default('1mb'),

  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // ---- Authentication ----
  // Secrets are optional outside production so a fresh clone boots; the refine
  // below makes them mandatory the moment NODE_ENV is `production`.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  JWT_ISSUER: z.string().min(1).default('agrisense'),
  JWT_AUDIENCE: z.string().min(1).default('agrisense-app'),
  /** Access token lifetime. Short by design — revocation lives on the refresh side. */
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),

  // ---- OTP ----
  /** Log the code instead of sending an SMS. Forced off in production. */
  OTP_DEV_MODE: booleanish.default('false'),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_MAX_REQUESTS_PER_WINDOW: z.coerce.number().int().positive().default(3),
  OTP_REQUEST_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),
  OTP_BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  /** Prefix applied to local-format numbers (`07…`) during normalisation. */
  DEFAULT_PHONE_COUNTRY_CODE: z
    .string()
    .regex(/^\+[1-9]\d{0,3}$/, 'must be a dialling code like "+94"')
    .default('+94'),
});

export type RawEnv = z.infer<typeof envSchema>;

const parsed = envSchema
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'is required in production',
        });
      }
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // The logger depends on this module, so this is the one place we must use
  // stderr directly: without valid config there is nothing to log with.
  console.error(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

/**
 * Stand-in secrets for development and tests. Distinct from one another so an
 * access token can never be replayed as a refresh token, and long enough to
 * satisfy the same validation the real values face. `superRefine` above rejects
 * the process outright if these would be reached in production.
 */
const DEV_ACCESS_SECRET = 'agrisense-development-access-secret-do-not-use-in-production';
const DEV_REFRESH_SECRET = 'agrisense-development-refresh-secret-do-not-use-in-production';

export const env = {
  ...raw,
  isDevelopment: raw.NODE_ENV === 'development',
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** `*` means "reflect any origin"; otherwise a concrete allow-list. */
  corsOrigins: raw.CORS_ORIGIN === '*' ? ('*' as const) : splitOrigins(raw.CORS_ORIGIN),
  jwt: {
    accessSecret: raw.JWT_ACCESS_SECRET ?? DEV_ACCESS_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET ?? DEV_REFRESH_SECRET,
    issuer: raw.JWT_ISSUER,
    audience: raw.JWT_AUDIENCE,
    accessTtlSeconds: raw.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: raw.JWT_REFRESH_TTL_SECONDS,
  },
  /**
   * Never true in production, whatever the file says: a misplaced `.env` must
   * not be able to turn real logins into console output.
   */
  otpDevMode: raw.OTP_DEV_MODE && raw.NODE_ENV !== 'production',
} as const;

export type Env = typeof env;

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
