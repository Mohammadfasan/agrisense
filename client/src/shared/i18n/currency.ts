import i18n, { getActiveLanguage } from './index';

/**
 * Money, in the only currency this app deals in.
 *
 * Here before there is a price screen to use it, deliberately. The first place
 * a number gets a currency beside it is the place the symbol gets hardcoded,
 * and the symbol that would be hardcoded on this project is the wrong one:
 * every Indian-market example a developer copies from writes `₹`, and every
 * Tamil-language design reference does too. This is Sri Lanka. The currency is
 * LKR and the symbol is "Rs.".
 *
 * The number is formatted by `Intl` in the farmer's language; the symbol comes
 * from the catalogues rather than from `Intl`, which is the part worth
 * explaining. `Intl.NumberFormat(lang, { style: 'currency', currency: 'LKR' })`
 * agrees with nobody: on the same runtime `si` gives "රු.", `ta` gives "LKR"
 * and `en` gives "LKR", and a device with a trimmed ICU build gives something
 * else again. Splitting the two means the digits get the locale's grouping and
 * the symbol is a translated string like every other word on the screen.
 */

/** ISO 4217. Sent to the API and used in nothing else. */
export const CURRENCY_CODE = 'LKR';

export interface CurrencyOptions {
  /**
   * Show the cents. Off by default: prices in this market are quoted in whole
   * rupees, and two trailing zeros on every row is noise on a 360px screen.
   */
  withCents?: boolean;
}

/**
 * An amount of money, as a farmer would read it aloud: `Rs. 1,250`.
 *
 * Reads the active language rather than taking one, so a caller cannot format
 * money in a language the rest of its screen is not in.
 */
export function formatCurrency(amount: number, options: CurrencyOptions = {}): string {
  const digits = options.withCents === true ? 2 : 0;

  const formatted = new Intl.NumberFormat(getActiveLanguage(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);

  // Two keys and not one interpolation, because the space between a symbol and
  // its digits is a typographic decision each language makes for itself.
  return i18n.t('currency.amount', {
    defaultValue: '{{symbol}} {{amount}}',
    symbol: i18n.t('currency.symbol', { defaultValue: 'Rs.' }),
    amount: formatted,
  });
}

/** A unit price, as the market boards quote it: `Rs. 250 / kg`. */
export function formatPricePerKg(amount: number, options: CurrencyOptions = {}): string {
  return i18n.t('currency.perKg', {
    defaultValue: '{{amount}} / kg',
    amount: formatCurrency(amount, options),
  });
}
