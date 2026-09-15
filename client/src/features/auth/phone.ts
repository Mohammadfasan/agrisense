import { z } from 'zod';

/**
 * Phone rules for the client, mirroring `server/src/modules/auth/phone.ts`.
 *
 * The server accepts every spelling a farmer might type (`0771234567`,
 * `94771234567`, `+94 77 123 4567`) and normalises them. S-02 fixes the
 * dialling code in the UI instead, so the field holds only the national part
 * and there is exactly one shape to validate. `toNationalDigits` still absorbs
 * the spellings a farmer actually reaches for -- it just does so as they type,
 * rather than accepting them and sorting it out at the end.
 */

/** Matches the server's `DEFAULT_PHONE_COUNTRY_CODE`. Fixed in the UI, not typed. */
export const PHONE_COUNTRY_CODE = '+94';

/** Digits after the dialling code. The field caps input at this length. */
export const PHONE_NATIONAL_DIGITS = 9;

/**
 * The one message for a badly shaped number, kept here so the schema and the
 * screen's i18n fallback cannot drift apart.
 */
export const PHONE_INVALID_MESSAGE = 'Enter a 9-digit mobile number starting with 7.';

/**
 * A Sri Lankan mobile number without its dialling code: `7X XXX XXXX`.
 *
 * Deliberately `7` followed by any eight digits rather than a list of the
 * prefixes in service today (070, 071, 072, 074-078). The operators are issued
 * new ones from time to time -- 079 was -- and a farmer holding a brand new
 * number must not be locked out by a stale allowlist in the client.
 */
export const phoneNationalSchema = z.string().regex(/^7\d{8}$/, PHONE_INVALID_MESSAGE);

/** Everything the API is given is E.164, which is also how the server stores it. */
export function toE164(national: string): string {
  return `${PHONE_COUNTRY_CODE}${national}`;
}

/**
 * What the field keeps of whatever was typed or pasted into it: digits only,
 * no trunk zero, no more than nine.
 *
 * Farmers say and write their number as `077 123 4567`, and will type that
 * leading zero out of habit even with `+94` sitting in front of it. It is the
 * trunk prefix, not part of the number -- `+940…` does not dial anywhere -- so
 * it is dropped rather than held against them at submit. The server's
 * `normalisePhone` makes the same swap for numbers that arrive whole.
 */
export function toNationalDigits(input: string): string {
  return (
    input
      .replace(/\D/g, '')
      // `+94…`, `0094…`: a whole number pasted in from contacts or an SMS,
      // dialling code and all, on top of the one already shown.
      .replace(/^(?:00)?94/, '')
      // `077…`: the trunk prefix. Neither can be part of a national number --
      // that has to start with 7 -- so neither is ambiguous.
      .replace(/^0+/, '')
      .slice(0, PHONE_NATIONAL_DIGITS)
  );
}
