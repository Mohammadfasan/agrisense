import { env } from '@config';
import { AppError } from '@shared';

/**
 * E.164: a leading `+`, a non-zero country code, then up to 15 digits total.
 */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises user input to the single E.164 form stored on `farmers.phone`.
 *
 * Sri Lankan farmers type their number the way they say it — `0771234567` —
 * while the client sometimes has it as `94771234567`. All three spellings have
 * to collapse to one string, or `{ phone: 1 }` being unique buys nothing and a
 * user gets a second account by typing their number differently.
 */
export function normalisePhone(input: string): string {
  const compact = input.replace(/[\s\-().]/g, '');
  const countryCode = env.DEFAULT_PHONE_COUNTRY_CODE;

  let candidate = compact;
  if (candidate.startsWith('00')) {
    candidate = `+${candidate.slice(2)}`;
  } else if (candidate.startsWith('0')) {
    // Local trunk form: swap the trunk prefix for the dialling code.
    candidate = `${countryCode}${candidate.slice(1)}`;
  } else if (!candidate.startsWith('+')) {
    // Bare digits: already carrying the country code, or a local number typed
    // without its trunk zero.
    const bare = countryCode.slice(1);
    candidate = candidate.startsWith(bare) ? `+${candidate}` : `${countryCode}${candidate}`;
  }

  if (!E164.test(candidate)) {
    throw AppError.validation('Phone number is not a valid E.164 number', { phone: input });
  }
  return candidate;
}

/**
 * `+9477…567` — for logs and rate-limit messages, which must never carry a
 * full number in plaintext.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) {
    return '***';
  }
  return `${phone.slice(0, 5)}…${phone.slice(-3)}`;
}
