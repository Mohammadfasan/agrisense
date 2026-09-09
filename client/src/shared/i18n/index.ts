import i18n from 'i18next';
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

const STORAGE_KEY = 'agrisense.lang';

function initialLanguage(): LanguageCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.some((lang) => lang.code === stored)) {
    return stored as LanguageCode;
  }
  const browser = navigator.language.split('-')[0];
  return SUPPORTED_LANGUAGES.some((lang) => lang.code === browser)
    ? (browser as LanguageCode)
    : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ta: { translation: ta },
    si: { translation: si },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // The catalogues start empty: every `t()` call in the app passes an English
  // default as its second argument, so the UI renders correctly until strings
  // are extracted and translated.
  parseMissingKeyHandler: (key, defaultValue) => defaultValue ?? key,
  returnEmptyString: false,
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
  document.documentElement.lang = lng;
});

document.documentElement.lang = i18n.language;

export default i18n;
