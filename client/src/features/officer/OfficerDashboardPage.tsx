import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { usePendingSyncCount } from '@/db/sync';

/** Extension-officer view: oversight across the farms in their division. */
export function OfficerDashboardPage(): ReactElement {
  const { t } = useTranslation();
  const pending = usePendingSyncCount();

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('officer.title', 'Officer dashboard')}</h2>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-muted-200 p-3">
          <dt className="text-sm text-muted">{t('officer.pendingSync', 'Pending sync')}</dt>
          <dd className="text-2xl font-semibold">{pending}</dd>
        </div>
      </dl>
    </section>
  );
}
