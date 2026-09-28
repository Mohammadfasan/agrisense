export const RETRY = {
  baseMs: 30 * 1000,
  maxMs: 60 * 60 * 1000,
  maxAttempts: 20,
  /**
   * How long a claim holds a scan. Longer than one diagnosis can take
   * (ML_TIMEOUT_MS is 8 s), so a slow call is never claimed twice; short
   * enough that a crashed worker's scan comes back soon.
   */
  leaseMs: 2 * 60 * 1000,
} as const;

/**
 * Delay before the next attempt, given how many attempts have now been made.
 * `null` means stop retrying. `random` is injectable so tests are exact.
 */
export function nextAttemptDelay(
  attempts: number,
  random: () => number = Math.random,
): number | null {
  if (attempts >= RETRY.maxAttempts) {
    return null;
  }
  const exponential = Math.min(RETRY.maxMs, RETRY.baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.round(exponential * (0.8 + 0.4 * random()));
}
