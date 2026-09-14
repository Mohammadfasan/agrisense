import { Leaf } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { OfflineBanner } from '@/shared/components/OfflineBanner';

import { NAV_ITEMS } from './navItems';

/**
 * The signed-in farmer shell: a bottom nav on phones, a left sidebar from `lg:`.
 *
 * Both navs are always rendered and the breakpoint hides one with CSS, rather
 * than choosing in JS with `useMediaQuery`. That way the first paint is already
 * correct and rotating a tablet swaps them without a re-render.
 */
export function AppShell({ children }: { children?: ReactNode }): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden border-r border-muted-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
        <div className="flex items-center gap-2 px-6 py-5">
          <Leaf className="h-7 w-7 text-primary" aria-hidden />
          <span className="text-lg font-semibold">{t('app.name', 'AgriSense')}</span>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-muted-200 px-4 py-3 lg:hidden">
          <Leaf className="h-6 w-6 text-primary" aria-hidden />
          <span className="text-lg font-semibold">{t('app.name', 'AgriSense')}</span>
        </header>

        <OfflineBanner />

        <main className="flex-1 p-4 lg:p-8">{children ?? <Outlet />}</main>

        <BottomNav />
      </div>
    </div>
  );
}

function SidebarNav(): ReactElement {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('nav.label', 'Main')} className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ to, icon: Icon, labelKey, fallback, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          className={({ isActive }) =>
            [
              'flex min-h-touch items-center gap-3 rounded-lg px-3 text-sm transition-colors',
              isActive
                ? 'bg-primary-50 font-medium text-primary-700'
                : 'text-muted-700 hover:bg-muted-100',
            ].join(' ')
          }
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          {t(labelKey, fallback)}
        </NavLink>
      ))}
    </nav>
  );
}

function BottomNav(): ReactElement {
  const { t } = useTranslation();

  return (
    // Thumb-reachable, every target meets the 44px minimum, and the bottom
    // padding clears the iOS home indicator (index.html sets viewport-fit=cover).
    <nav
      aria-label={t('nav.label', 'Main')}
      className="sticky bottom-0 grid grid-cols-5 border-t border-muted-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {NAV_ITEMS.map(({ to, icon: Icon, labelKey, fallback, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          className={({ isActive }) =>
            [
              'flex min-h-touch flex-col items-center justify-center gap-1 py-2 text-xs',
              isActive ? 'font-medium text-primary' : 'text-muted',
            ].join(' ')
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
          {/* Columns are ~64px on a small phone, and "මුල් පිටුව" or
              "சுயவிவரம்" can wrap. Keep the wrap tight and centred. */}
          <span className="px-1 text-center leading-tight">{t(labelKey, fallback)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
