import type { ReactElement } from 'react';
import { Leaf, LineChart, MapPin, ScanLine, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { OfflineBanner } from '@/shared/components/OfflineBanner';

const NAV = [
  { to: '/farms', icon: MapPin, key: 'nav.farms', fallback: 'Farms' },
  { to: '/scan', icon: ScanLine, key: 'nav.scan', fallback: 'Scan' },
  { to: '/market', icon: LineChart, key: 'nav.market', fallback: 'Market' },
  { to: '/officer', icon: ShieldCheck, key: 'nav.officer', fallback: 'Officer' },
] as const;

export function AppLayout(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-muted-200 px-4 py-3">
        <Leaf className="h-6 w-6 text-primary" aria-hidden />
        <h1 className="text-lg font-semibold">{t('app.name', 'AgriSense')}</h1>
      </header>

      <OfflineBanner />

      <main className="flex-1 p-4">
        <Outlet />
      </main>

      {/* Thumb-reachable bottom nav; every target meets the 44px minimum. */}
      <nav className="sticky bottom-0 grid grid-cols-4 border-t border-muted-200 bg-white">
        {NAV.map(({ to, icon: Icon, key, fallback }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex min-h-touch flex-col items-center justify-center gap-1 py-2 text-xs',
                isActive ? 'text-primary font-medium' : 'text-muted',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
            {t(key, fallback)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
