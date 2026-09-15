import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import si from './locales/si.json';
import ta from './locales/ta.json';

/**
 * Presentation order, used wherever the three are offered as a choice: the two
 * national languages first, English last.
 *
 * `label` names the language in its own script, for the full-screen select
 * where it may be the only word a farmer can read. `short` is the same name
 * trimmed to fit the compact switcher in the login header -- only English
 * shortens, because "தமிழ்" and "සිංහල" are already single words and
 * abbreviating either would leave nothing recognisable.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'ta', label: 'தமிழ்', short: 'தமிழ்' },
  { code: 'si', label: 'සිංහල', short: 'සිංහල' },
  { code: 'en', label: 'English', short: 'EN' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/**
 * The language the UI is in. The key the app has always used, so a language
 * saved by an earlier build still applies.
 */
const LANGUAGE_KEY = 'agrisense.lang';

/**
 * Whether a farmer picked that language themselves.
 *
 * Deliberately separate from `LANGUAGE_KEY`: the detector's reading of the
 * device is a default, not an answer, and only an answer may stand in for the
 * language select (S-01). One key cannot say both -- a language with no flag
 * beside it is a guess, and the same value with the flag is a decision.
 */
const CHOSEN_KEY = 'agrisense.lang.chosen';

function isLanguageCode(value: unknown): value is LanguageCode {
  return SUPPORTED_LANGUAGES.some((lang) => lang.code === value);
}

/**
 * Safari in private mode throws on `localStorage` rather than returning null,
 * and a farmer who cannot store anything should still get a working app.
 */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (cause) {
    // Whatever prompted the write still takes effect in this tab; the app just
    // asks again next launch.
    console.warn('Could not save the language choice', cause);
  }
}

// Builds before the flag was split out wrote the language only when a farmer
// picked one, so a stored language with no flag beside it is a choice an
// earlier build recorded. Adopted once, here, rather than asking again -- and
// it is safe to read the absence this way because nothing but `applyLanguage`
// has ever written `LANGUAGE_KEY` (see `caches` below).
if (readStored(CHOSEN_KEY) === null && isLanguageCode(readStored(LANGUAGE_KEY))) {
  writeStored(CHOSEN_KEY, '1');
}

// Resources are bundled, so init runs synchronously and `i18n.language` is set
// before the first render.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ta: { translation: ta },
      si: { translation: si },
    },
    // Also narrows regional codes: a device set to `ta-LK` gets `ta`.
    supportedLngs: SUPPORTED_LANGUAGES.map((lang) => lang.code),
    fallbackLng: 'en',
    detection: {
      // A language picked in the app beats the device's.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_KEY,
      // Deliberately no `caches`. The detector writes whatever it resolves --
      // including a guess from `navigator` -- straight back to localStorage,
      // and a guess parked in `LANGUAGE_KEY` is what the legacy migration
      // above would read as a choice. Only `applyLanguage` writes these keys.
      caches: [],
    },
    interpolation: { escapeValue: false },
    // Catalogues hold only the keys translated so far. Every `t()` call in the
    // app passes an English default as its second argument, so a key missing
    // from every catalogue still renders.
    parseMissingKeyHandler: (key, defaultValue) => defaultValue ?? key,
    returnEmptyString: false,
  });

/**
 * True once a farmer has picked a language themselves. This -- and not the
 * language the UI happens to be in -- is what stands in for S-01, so a device
 * the detector read correctly is still asked.
 */
export function hasChosenLanguage(): boolean {
  return readStored(CHOSEN_KEY) === '1';
}

/**
 * The language the UI is in, narrowed to one the app ships.
 *
 * `supportedLngs` already does the narrowing -- a device set to `ta-LK` leaves
 * `i18n.language` as `ta`, and one set to `fr-FR` as `en` -- so this only has
 * to state that in the type. The region is stripped and the result re-checked
 * anyway, because every caller here is about to send this code somewhere that
 * accepts three values and nothing else. (`resolvedLanguage` looks like the
 * better source and is not: it reads `undefined` until something calls
 * `changeLanguage`, so on a detected first visit there would be nothing in it.)
 */
export function getActiveLanguage(): LanguageCode {
  const [base] = i18n.language.split('-');
  return isLanguageCode(base) ? base : 'en';
}

/**
 * Records a farmer's choice: switches the UI immediately, remembers the
 * language for the next launch, and marks it as chosen rather than detected.
 * Go through `useAuthStore.setLanguage` rather than calling this directly, so
 * the store's copy of the flag stays in step.
 */
export function applyLanguage(code: LanguageCode): void {
  writeStored(LANGUAGE_KEY, code);
  writeStored(CHOSEN_KEY, '1');
  void i18n.changeLanguage(code);
}

// `:lang(si)` and `:lang(ta)` in the stylesheet key off this.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

document.documentElement.lang = i18n.language;

export default i18n;
