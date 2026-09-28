import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startRetryScheduler } from './retryScheduler';
import type { SweepResult } from './scan.service';

const EMPTY: SweepResult = { claimed: 0, decided: 0, deferred: 0 };

describe('retry scheduler without Redis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweeps on every interval', async () => {
    const sweep = vi.fn(() => Promise.resolve(EMPTY));
    const scheduler = startRetryScheduler({ sweep, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3500);

    expect(scheduler.mode).toBe('interval');
    expect(sweep).toHaveBeenCalledTimes(3);
    await scheduler.stop();
  });

  it('never starts a sweep while the last one is still running', async () => {
    const pending: (() => void)[] = [];
    const sweep = vi.fn(
      () =>
        new Promise<SweepResult>((resolve) => {
          pending.push(() => {
            resolve(EMPTY);
          });
        }),
    );
    const scheduler = startRetryScheduler({ sweep, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(5000);
    expect(sweep).toHaveBeenCalledTimes(1);

    pending[0]?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(2);

    pending[1]?.();
    await scheduler.stop();
  });

  it('keeps sweeping after a sweep fails', async () => {
    const sweep = vi
      .fn<() => Promise<SweepResult>>()
      .mockRejectedValueOnce(new Error('MongoDB blinked'))
      .mockResolvedValue(EMPTY);
    const scheduler = startRetryScheduler({ sweep, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(2500);

    expect(sweep).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('stop() waits for the running sweep, and then sweeps no more', async () => {
    let finish = (): void => undefined;
    const sweep = vi.fn(
      () =>
        new Promise<SweepResult>((resolve) => {
          finish = () => {
            resolve(EMPTY);
          };
        }),
    );
    const scheduler = startRetryScheduler({ sweep, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
