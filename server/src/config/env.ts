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
});

export type RawEnv = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

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

export const env = {
  ...raw,
  isDevelopment: raw.NODE_ENV === 'development',
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** `*` means "reflect any origin"; otherwise a concrete allow-list. */
  corsOrigins: raw.CORS_ORIGIN === '*' ? ('*' as const) : splitOrigins(raw.CORS_ORIGIN),
} as const;

export type Env = typeof env;

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
