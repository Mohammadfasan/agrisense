import { Bell, Leaf } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { cx } from '@/shared/utils/cx';

import { ConnectivityStatus } from './ConnectivityStatus';
import { FEATURES } from './features';
import { NAV_ITEMS, type NavItem } from './navItems';

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
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
          </div>
        </div>
        <div className="px-6 pb-3 empty:hidden">
          <ConnectivityStatus />
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Compact by design: on a 360x640 phone every row of chrome is a row
            of content a farmer has to scroll for. Brand on the left, then the
            two things that are about right now — whether the phone can reach
            the server, and whether anything is waiting to be read. */}
        <header className="flex items-center gap-2 border-b border-muted-200 px-4 py-2 lg:hidden">
          <Leaf className="h-6 w-6 shrink-0 text-primary" aria-hidden />
          <span className="text-lg font-semibold">{t('app.name', 'AgriSense')}</span>
          <div className="ml-auto flex items-center gap-2">
            <ConnectivityStatus />
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8">{children ?? <Outlet />}</main>

        <BottomNav />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Outbreak alerts and scan results are Week 8; there is nothing to ring about
 * yet, so the bell is inert.
 *
 * Kept on screen rather than added later because its absence is not neutral:
 * it is where a farmer will look for a warning about their own district, and a
 * header that grows a new control months in is a header they have to relearn.
 * Disabled and not merely unstyled — it is out of the tab order, and the
 * "coming soon" is on it for a screen reader, which is the one audience that
 * cannot see that it is dimmed.
 */
function NotificationBell(): ReactElement {
  const { t } = useTranslation();
  const enabled = FEATURES.notifications.enabled;

  return (
    <button
      type="button"
      disabled={!enabled}
      className="inline-flex min-h-touch-md min-w-touch-md items-center justify-center rounded-full text-muted-700 hover:bg-muted-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:text-muted"
    >
      <Bell className="h-6 w-6" aria-hidden />
      <span className="sr-only">
        {t('home.notifications', 'Notifications')}
        {!enabled && ` — ${t('common.comingSoon', 'Coming soon')}`}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/** Whether the destination behind a nav item exists yet. */
function isNavItemEnabled(item: NavItem): boolean {
  return item.feature === undefined || FEATURES[item.feature].enabled;
}

function SidebarNav(): ReactElement {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('nav.label', 'Main')} className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map((item) => {
        const { to, icon: Icon, labelKey, fallback, end } = item;
        const label = t(labelKey, fallback);
        const shared = 'flex min-h-touch-md items-center gap-3 rounded-lg px-3 text-sm';

        if (!isNavItemEnabled(item)) {
          return (
            <DisabledNavItem key={to} className={cx(shared, 'text-muted')}>
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {label}
            </DisabledNavItem>
          );
        }

        return (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cx(
                shared,
                'transition-colors',
                isActive
                  ? 'bg-primary-50 font-medium text-primary-700'
                  : 'text-muted-700 hover:bg-muted-100',
              )
            }
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function BottomNav(): ReactElement {
  const { t } = useTranslation();

  return (
    // Thumb-reachable, every target clears 48px, and the bottom padding clears
    // the iOS home indicator (index.html sets viewport-fit=cover). Four
    // columns: see the note in `navItems.ts`.
    <nav
      aria-label={t('nav.label', 'Main')}
      className="sticky bottom-0 grid grid-cols-4 border-t border-muted-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const { to, icon: Icon, labelKey, fallback, end } = item;
        const label = t(labelKey, fallback);
        const shared =
          'flex min-h-touch-md flex-col items-center justify-center gap-1 px-1 py-2 text-xs';

        if (!isNavItemEnabled(item)) {
          return (
            <DisabledNavItem key={to} className={cx(shared, 'text-muted')}>
              <Icon className="h-6 w-6" aria-hidden />
              <NavLabel>{label}</NavLabel>
            </DisabledNavItem>
          );
        }

        return (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cx(shared, isActive ? 'font-medium text-primary' : 'text-muted-700')
            }
          >
            <Icon className="h-6 w-6" aria-hidden />
            <NavLabel>{label}</NavLabel>
          </NavLink>
        );
      })}
    </nav>
  );
}

/**
 * A destination whose feature has not shipped: dimmed, out of the tab order,
 * and still labelled.
 *
 * A `<span>` rather than a disabled `<button>` or a `<NavLink>` to nowhere.
 * It is not a control and never becomes one — the same item is a real link the
 * moment its flag flips — so the honest markup is text, with the reason
 * attached for anyone who cannot see that it is grey.
 */
function DisabledNavItem({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <span aria-disabled="true" className={className}>
      {children}
      <span className="sr-only">{t('common.comingSoon', 'Coming soon')}</span>
    </span>
  );
}

/**
 * Columns are ~90px on a 360px phone, and "මුල් පිටුව" or "சுயவிவரம்" can
 * wrap. Keep the wrap tight and centred.
 */
function NavLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-center leading-tight">{children}</span>;
}
