import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import si from './locales/si.json';
import ta from './locales/ta.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'si', label: 'සිංහල' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** The key the app has always used, so a choice saved by an earlier build still applies. */
const STORAGE_KEY = 'agrisense.lang';

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
      // A language picked in the app beats the device's. Whatever is resolved
      // is written back, so every later `changeLanguage` is remembered.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    // Catalogues hold only the keys translated so far. Every `t()` call in the
    // app passes an English default as its second argument, so a key missing
    // from every catalogue still renders.
    parseMissingKeyHandler: (key, defaultValue) => defaultValue ?? key,
    returnEmptyString: false,
  });

// `:lang(si)` and `:lang(ta)` in the stylesheet key off this.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

document.documentElement.lang = i18n.language;

export default i18n;
