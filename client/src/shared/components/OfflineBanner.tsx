import type { ReactElement } from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus';
import { usePendingSyncCount } from '@/db/sync';

/** Tells the user why their data has not reached the server yet. */
export function OfflineBanner(): ReactElement | null {
  const isOnline = useOnlineStatus();
  const pending = usePendingSyncCount();
  const { t } = useTranslation();

  if (isOnline && pending === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 bg-warning-100 px-4 py-2 text-sm text-warning-900">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {isOnline
          ? t('sync.pending', '{{count}} change(s) waiting to sync', { count: pending })
          : t('sync.offline', 'Offline — changes are saved on this device')}
      </span>
    </div>
  );
}
