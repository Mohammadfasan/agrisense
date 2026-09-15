import type { TFunction } from 'i18next';

import { getApiErrorCode, getApiErrorDetails } from '@/shared/api/client';

type Message = readonly [key: string, fallback: string];

/** Keyed by the server's `ErrorCode`. */
const ERROR_MESSAGES: Record<string, Message> = {
  VALIDATION_ERROR: ['auth.error.validation', 'Check the details and try again.'],
  OTP_RATE_LIMITED: ['auth.error.rateLimited', 'Too many codes requested. Try again later.'],
  OTP_INVALID: ['auth.error.invalid', 'That code is incorrect.'],
  OTP_EXPIRED: ['auth.error.expired', 'That code has expired. Request a new one.'],
  OTP_ATTEMPTS_EXCEEDED: ['auth.error.attempts', 'Too many attempts. Request a new code.'],
  ACCOUNT_INACTIVE: ['auth.error.inactive', 'This account is no longer active.'],
  // `PROFILE_REQUIRED` is deliberately absent: it is not a failure, it is the
  // store asking S-03 for a name and district. It falls through to the generic
  // message only if a screen shows it without handling `needsProfile`.
};

const GENERIC_ERROR: Message = [
  'auth.error.generic',
  'Something went wrong. Check your connection and try again.',
];

/** Turns anything thrown by an auth call into a sentence a farmer can act on. */
export function getAuthErrorMessage(cause: unknown, t: TFunction): string {
  const code = getApiErrorCode(cause);
  const attemptsRemaining = code === 'OTP_INVALID' ? getAttemptsRemaining(cause) : undefined;
  if (attemptsRemaining !== undefined) {
    return t('auth.error.invalidWithAttempts', {
      count: attemptsRemaining,
      defaultValue: 'That code is incorrect. {{count}} attempts left.',
    });
  }
  const [key, fallback] = ERROR_MESSAGES[code ?? ''] ?? GENERIC_ERROR;
  return t(key, fallback);
}

/**
 * How many tries the server says are left, when it said. `OTP_INVALID` is the
 * one error worth expanding on: the count is what a farmer needs to choose
 * between re-reading the SMS and asking for a new code, and the server is the
 * only one that knows it -- attempts are counted per code, not per device.
 *
 * Absent, or zero, falls back to the plain message. Zero only reaches here in a
 * race, since the server answers the last attempt with `OTP_ATTEMPTS_EXCEEDED`.
 */
function getAttemptsRemaining(cause: unknown): number | undefined {
  const remaining = getApiErrorDetails(cause)?.attemptsRemaining;
  return typeof remaining === 'number' && remaining > 0 ? remaining : undefined;
}
