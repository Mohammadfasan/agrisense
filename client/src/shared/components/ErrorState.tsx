import { CloudOff, RotateCw, TriangleAlert } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus';
import { cx } from '@/shared/utils/cx';

/**
 * What a screen shows instead of nothing when a read fails.
 *
 * The sibling of {@link EmptyState}, and shaped like it on purpose: a screen
 * that has no data has to say so whichever of the two reasons it is, and a
 * farmer should not have to work out from the layout which one they are
 * looking at. Empty means "there is nothing here yet"; this means "there is
 * something here and we could not reach it", which is the one that comes with
 * a way out.
 *
 * **The offline case says so in words.** Every call site used to end its
 * message with "Check your connection", which is a guess — it is equally the
 * sentence for a 500. `navigator.onLine` is the one thing the device actually
 * knows, so when it is false this says the farmer is offline and stops
 * blaming the server; when it is true it does not mention the connection at
 * all. The distinction matters where this app is used: a farmer on the edge of
 * coverage is offline several times a day and needs to recognise it, not
 * re-read the same sentence.
 *
 * **Retry is a button, not an instruction.** "Try again" with nothing to press
 * means reloading the app, which on a phone with one bar costs the farmer
 * everything else the cache is holding.
 */
export interface ErrorStateProps {
  /**
   * What failed, for the case where the device believes it is online. Written
   * without "check your connection" — see above.
   */
  description: string;
  /** Overrides the heading. Defaults to a plain "Could not load". */
  title?: string;
  /** Wired to the query's `refetch`, or the store's fetch. */
  onRetry?: () => void;
  /** Anything else worth offering, usually a way back. */
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  description,
  title,
  onRetry,
  action,
  className,
}: ErrorStateProps): ReactElement {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const Icon = isOnline ? TriangleAlert : CloudOff;

  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <Icon className="h-6 w-6" aria-hidden />
      </span>

      <div className="flex max-w-xs flex-col gap-1">
        {/* `role="alert"` on the line that changed, not on the wrapper: a
            screen reader should hear what went wrong, not the retry button's
            label read out as part of the announcement. */}
        <p role="alert" className="font-semibold text-gray-900">
          {isOnline
            ? (title ?? t('common.error.title', 'Could not load'))
            : t('common.error.offlineTitle', 'You are offline')}
        </p>
        <p className="text-sm text-muted">
          {isOnline
            ? description
            : t(
                'common.error.offline',
                'This will load as soon as you have a signal. Anything you have already saved is still here.',
              )}
        </p>
      </div>

      {(onRetry !== undefined || action !== undefined) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {onRetry !== undefined && (
            <button type="button" onClick={onRetry} className="btn-secondary min-h-touch-md px-5">
              <RotateCw className="h-5 w-5" aria-hidden />
              {t('common.retry', 'Try again')}
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
