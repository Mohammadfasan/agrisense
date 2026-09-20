import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Integration tests run against a real MongoDB — an in-memory one, started per
 * test file by `src/test/mongo.setup.ts`. TTL indexes, unique constraints and
 * guarded updates are the whole point of the auth code, and a mocked
 * repository would assert nothing about any of them.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/mongo.setup.ts'],
    // Each file owns a mongod; running them together would multiply memory
    // for no wall-clock gain on a suite this size.
    fileParallelism: false,
    // Downloading and booting mongod on a cold cache is slow.
    hookTimeout: 180_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // `text` for the terminal, `lcov` for whatever reads it in CI later.
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // Files no test touches still count. Without `all` an untested module
      // reports nothing rather than reporting zero, and zero is the one
      // number worth seeing.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // The harness itself: measuring the tests' own helpers says nothing
        // about the code under test.
        'src/test/**',
        // Types and re-exports; nothing to execute.
        'src/**/*.d.ts',
        'src/**/index.ts',
      ],
    },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      // Overridden per connection by the setup file; only needs to satisfy
      // the schema in `config/env.ts` at import time.
      MONGODB_URI: 'mongodb://127.0.0.1:27017/agrisense-test',
      // Codes are logged and returned rather than sent.
      OTP_DEV_MODE: 'true',
      // The floor bcrypt allows: these tests hash constantly and are not
      // measuring the work factor.
      OTP_BCRYPT_ROUNDS: '4',
    },
  },
});
