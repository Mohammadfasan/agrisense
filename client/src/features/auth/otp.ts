import { useEffect, useState } from 'react';

/**
 * OTP rules the client needs to draw S-03, mirroring the server's `env`
 * defaults in `server/src/config/env.ts`.
 */

/**
 * Boxes on the code screen. Matches the server's `OTP_LENGTH` default.
 *
 * The server will accept a code of any configured length and never tells the
 * client which it used, so this is the one place the two can drift. A code
 * screen with the wrong number of boxes is immediately obvious in dev mode,
 * where the code is printed above the field.
 */
export const OTP_CODE_LENGTH = 6;

/** Digits only, and never more than the boxes can hold. */
export function toCodeDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH);
}

/**
 * `m:ss`, for the life of a code. No hours case: the server's `OTP_TTL_SECONDS`
 * is five minutes, and every second of it counts to someone waiting on an SMS.
 */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

const WAIT_FORMATS = new Map<string, Intl.RelativeTimeFormat>();

/**
 * A wait, in the largest unit that still says something: "in 45 seconds", "in
 * 12 minutes", "in 1 hour".
 *
 * Not `formatCountdown`: the rate-limit window is an hour wide, and an hour
 * spelled `60:00` and ticking is both unreadable and a precision nobody asked
 * for. `Intl.RelativeTimeFormat` rather than a translated string per unit, so
 * Sinhala and Tamil get their number words and plural rules from the platform
 * instead of from three hand-written catalogues.
 */
export function formatWait(seconds: number, locale: string): string {
  let format = WAIT_FORMATS.get(locale);
  if (format === undefined) {
    // `always`, not `auto`: `auto` renders a minute away as "next minute".
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
    WAIT_FORMATS.set(locale, format);
  }
  if (seconds < 60) {
    // Never "in 0 seconds" -- by the time that rendered it would be wrong.
    return format.format(Math.max(seconds, 1), 'second');
  }
  if (seconds < 3600) {
    return format.format(Math.ceil(seconds / 60), 'minute');
  }
  return format.format(Math.ceil(seconds / 3600), 'hour');
}

/**
 * Whole seconds left until `deadline` (an ISO timestamp), counting down to
 * zero and stopping there.
 *
 * Every tick is measured against the deadline rather than decrementing a
 * counter, because a phone that sleeps in a farmer's pocket stops firing
 * timers: a decrementing counter would come back reading whatever it held when
 * the screen went off. `visibilitychange` catches the moment it wakes, so the
 * clock is right before the next tick rather than up to a second after.
 *
 * Returns 0 for a missing or unparseable deadline, which reads as expired --
 * the safe way round, since it offers a new code rather than a dead field.
 */
export function useSecondsRemaining(deadline: string | undefined): number {
  const expiresAt = deadline === undefined ? Number.NaN : Date.parse(deadline);
  const [remaining, setRemaining] = useState(() => secondsUntil(expiresAt));

  useEffect(() => {
    const read = (): number => {
      const next = secondsUntil(expiresAt);
      setRemaining(next);
      return next;
    };

    // The deadline may have changed (a resent code) since the last render.
    if (read() === 0) {
      return undefined;
    }

    const timer = setInterval(() => {
      if (read() === 0) {
        clearInterval(timer);
      }
    }, 1000);
    document.addEventListener('visibilitychange', read);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [expiresAt]);

  return remaining;
}

function secondsUntil(expiresAt: number): number {
  if (Number.isNaN(expiresAt)) {
    return 0;
  }
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}
