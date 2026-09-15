import { ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/shared/i18n';

import { useAuthStore } from './authStore';
import { useLoginRedirectState } from './redirect';

/**
 * S-01 — language select. The first thing a farmer sees, before they have read
 * a word of the app, so the only copy that has to be understood is on the
 * buttons themselves: each is written in its own script, not translated.
 */
export function LanguagePage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const redirectState = useLoginRedirectState();
  const languageChosenByUser = useAuthStore((state) => state.languageChosenByUser);
  const setLanguage = useAuthStore((state) => state.setLanguage);

  // Asked once, ever -- but only an answer counts. The UI is always in some
  // language, because the detector reads one off the device; what forwards
  // past this screen is this farmer having picked it.
  if (languageChosenByUser) {
    return <Navigate to="/login/phone" replace state={redirectState} />;
  }

  const choose = (code: LanguageCode): void => {
    // Switches i18n and writes the choice through before navigating, so the
    // next screen renders in the new language on its first paint.
    setLanguage(code);
    // `replace`, because the moment a language is set this screen forwards to
    // the next one: left in the history it would be a back-button trap.
    navigate('/login/phone', { replace: true, state: redirectState });
  };

  return (
    <>
      <div className="flex flex-col gap-1 text-center lg:text-left">
        <h2 className="text-xl font-semibold lg:text-2xl">
          {t('auth.language.title', 'Choose your language')}
        </h2>
        <p className="text-sm text-muted">
          {t('auth.language.hint', 'You can change this later from your profile.')}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {SUPPORTED_LANGUAGES.map(({ code, label }) => (
          <li key={code}>
            <button
              type="button"
              // Tells a screen reader to read the name in its own language
              // rather than in the one the page happens to be in.
              lang={code}
              onClick={() => {
                choose(code);
              }}
              className="btn-secondary min-h-touch-lg w-full justify-between px-5 text-xl font-medium"
            >
              {label}
              <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
