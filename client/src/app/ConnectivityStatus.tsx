import { WifiOff } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus';

/**
 * The connectivity slot in the app header — and the place the Week 6 sync
 * indicator goes.
 *
 * Today it says one thing: whether the phone has a connection. It is a chip in
 * the header rather than a banner across the screen because, for this user,
 * being offline is the normal state and not an incident — a farmer at the edge
 * of a field loses signal several times an hour, and a full-width warning bar
 * each time trains them to ignore it.
 *
 * Week 6 turns this into "offline · 3 pending": the outbox in `@/db/sync`
 * already counts queued writes, and this is where that count is appended. It
 * is deliberately not read here yet. The count is only honest once something
 * writes to the outbox and something drains it, and a "0 pending" badge over a
 * sync engine that does not exist is a claim the app cannot back.
 *
 * Renders nothing while online. Green "connected" chips are for dashboards; on
 * a phone in sunlight the only state worth a pixel is the one that changes
 * what a farmer can do next.
 */
export function ConnectivityStatus(): ReactElement | null {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    // `role="status"` rather than an alert: it should be announced when it
    // changes, without interrupting whatever is being read.
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-warning-100 px-3 py-1.5 text-sm font-medium text-warning-900"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      {t('status.offline', 'Offline')}
    </span>
  );
}
