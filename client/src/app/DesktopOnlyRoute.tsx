import { Monitor } from 'lucide-react';
import type { ReactNode, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';

import { DESKTOP_QUERY, useMediaQuery } from '@/shared/hooks/useMediaQuery';

/**
 * Renders its routes only at desktop width. Below that it explains why rather
 * than redirecting, so an officer on a phone is not silently bounced.
 */
export function DesktopOnlyRoute({ children }: { children?: ReactNode }): ReactElement {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  if (!isDesktop) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
        <Monitor className="h-10 w-10 text-muted" aria-hidden />
        <p className="font-medium">{t('desktopOnly.title', 'Open this on a computer')}</p>
        <p className="text-sm text-muted">
          {t('desktopOnly.body', 'This section needs a larger screen.')}
        </p>
        <Link to="/" className="btn-ghost">
          {t('desktopOnly.back', 'Back to the app')}
        </Link>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
