import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { getActiveLanguage, SUPPORTED_LANGUAGES } from '@/shared/i18n';
import { cx } from '@/shared/utils/cx';

import { useAuthStore } from './authStore';

/**
 * The compact language switcher in the login header, so a farmer who picked
 * the wrong one on S-01 -- or was never asked, because an earlier visit
 * answered for them -- can correct it without going back a step.
 *
 * A row of buttons rather than a `<select>`: three options fit, and a native
 * picker on Android renders the Tamil and Sinhala names in the system font at
 * the system size, which is the one thing this control cannot afford to get
 * wrong. Each label is written in its own script and carries `lang`, so a
 * screen reader reads it in that language rather than in the page's.
 */
export function LanguageSwitcher(): ReactElement {
  // `useTranslation` re-renders this component on `languageChanged`, which is
  // what keeps the mark below in step with the language actually in force.
  const { t } = useTranslation();
  const setLanguage = useAuthStore((state) => state.setLanguage);
  const active = getActiveLanguage();

  return (
    <div
      // `group` rather than `radiogroup`: these take effect on click instead of
      // arming a choice a form submit later applies, and arrow-key navigation
      // between them would be a keyboard trap on a control with no submit.
      role="group"
      aria-label={t('auth.language.switcher', 'Language')}
      className="inline-flex gap-0.5 rounded-lg border border-muted-300 p-0.5"
    >
      {SUPPORTED_LANGUAGES.map(({ code, short }) => {
        const isActive = code === active;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            // Not `disabled` when active: it would drop out of the tab order
            // and stop announcing itself, and there is nothing wrong with
            // pressing the language you are already in.
            aria-pressed={isActive}
            onClick={() => {
              // Through the store, not `i18n.changeLanguage`: switching here is
              // as much a decision as tapping a button on S-01, so it has to be
              // written down as one. Otherwise the next launch asks again, in a
              // language this farmer has already rejected once.
              setLanguage(code);
            }}
            className={cx(
              'min-h-touch rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              isActive ? 'bg-primary text-white' : 'text-muted-700 hover:bg-muted-100',
            )}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}
