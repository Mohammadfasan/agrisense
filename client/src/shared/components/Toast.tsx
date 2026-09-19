import { X } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '@/shared/utils/cx';

import { useToastStore } from './toastStore';

/** How long a message stays up. Long enough to read twice in a second language. */
const DISMISS_AFTER_MS = 6000;

/**
 * Where a short message appears: above the bottom nav, over whatever is on
 * screen.
 *
 * Mounted once, in the app shell. It is not a dialog and never takes focus —
 * these messages arrive while the farmer is mid-tap, and stealing focus would
 * lose them their place in a list for something they do not have to answer.
 * The live region does the announcing instead: `alert` for a failure, which
 * interrupts, and `status` for the rest, which waits its turn.
 *
 * The region itself is always rendered, empty or not. A live region inserted
 * at the same moment as its text is not reliably announced — the screen reader
 * has to have been watching it already.
 */
export function ToastViewport(): ReactElement {
  const { t } = useTranslation();
  const current = useToastStore((state) => state.current);
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    if (current === null) {
      return;
    }
    const id = current.id;
    const timer = setTimeout(() => {
      dismiss(id);
    }, DISMISS_AFTER_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [current, dismiss]);

  return (
    <div
      // Clears the bottom nav on a phone and the iOS home indicator under it;
      // from `lg:` the nav is a sidebar and neither applies.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 flex justify-center px-4 lg:bottom-8"
    >
      <div
        role={current?.tone === 'error' ? 'alert' : 'status'}
        aria-live={current?.tone === 'error' ? 'assertive' : 'polite'}
        className="w-full max-w-md empty:hidden"
      >
        {current !== null && (
          <div
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg',
              current.tone === 'error' ? 'bg-danger-700 text-white' : 'bg-gray-900 text-white',
            )}
          >
            <p className="min-w-0 flex-1 text-base">{current.message}</p>
            <button
              type="button"
              onClick={() => {
                dismiss(current.id);
              }}
              className="-my-1 -mr-2 inline-flex min-h-touch-md min-w-touch-md shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="h-5 w-5" aria-hidden />
              <span className="sr-only">{t('common.close', 'Close')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
