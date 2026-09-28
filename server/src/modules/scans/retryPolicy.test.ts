import { describe, expect, it } from 'vitest';

import { RETRY, nextAttemptDelay } from './retryPolicy';

const middle = (): number => 0.5; // no jitter: factor exactly 1.0

describe('nextAttemptDelay', () => {
  it('doubles from 30 seconds', () => {
    expect(nextAttemptDelay(1, middle)).toBe(30_000);
    expect(nextAttemptDelay(2, middle)).toBe(60_000);
    expect(nextAttemptDelay(3, middle)).toBe(120_000);
    expect(nextAttemptDelay(4, middle)).toBe(240_000);
  });

  it('never waits more than an hour', () => {
    expect(nextAttemptDelay(15, middle)).toBe(RETRY.maxMs);
    expect(nextAttemptDelay(19, middle)).toBe(RETRY.maxMs);
  });

  it('spreads retries by up to 20% either way', () => {
    expect(nextAttemptDelay(1, () => 0)).toBe(24_000);
    expect(nextAttemptDelay(1, () => 1)).toBe(36_000);
  });

  it('stops after the last attempt', () => {
    expect(nextAttemptDelay(RETRY.maxAttempts, middle)).toBeNull();
    expect(nextAttemptDelay(RETRY.maxAttempts + 5, middle)).toBeNull();
  });
});
