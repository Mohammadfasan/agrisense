import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { LanguagePage, LoginLayout, PhonePage, VerifyPage, type UserRole } from '@/features/auth';

import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { DesktopOnlyRoute } from './DesktopOnlyRoute';
import { FEATURES } from './features';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireProfile } from './RequireProfile';
import { RoleRoute } from './RoleRoute';

const OFFICER_PORTAL_ROLES: readonly UserRole[] = ['officer', 'admin'];

/**
 * Feature routes are loaded on demand. The charts (recharts) and the map
 * (leaflet, once the plot boundary editor lands) are the heaviest dependencies
 * in the app and neither is needed to sign in or to open the scan screen — on
 * a 3G connection that difference is seconds.
 *
 * Guards are pathless layout routes, so each one wraps a whole subtree:
 *
 *   AuthLayout
 *   └── LoginLayout             public; the signed-in redirect lives here
 *       ├── /login              S-01 language select
 *       ├── /login/phone        S-02 phone entry
 *       └── /login/verify       S-03 code entry (+ profile, for a new number)
 *   ProtectedRoute
 *   ├── /onboarding             signed in, no profile yet; outside RequireProfile
 *   ├── RequireProfile
 *   │   └── /  (AppShell)       bottom nav → sidebar at lg
 *   │       ├── /               home
 *   │       ├── /plots, /plots/new, /plots/:id/edit, /plots/:id/calendar
 *   │       ├── /scan           only once FEATURES.scan is on (Week 5)
 *   │       ├── /market         only once FEATURES.prices is on (Week 7)
 *   │       └── /profile
 *   └── /officer/*  RoleRoute → DesktopOnlyRoute
 *   /dev/components             public; development builds only
 *
 * `RequireProfile` wraps the farmer subtree and not the officer portal:
 * officers have no farmer profile of their own, and `/onboarding` sits outside
 * it because it is where that guard sends people.
 */

/**
 * The routes behind an unfinished feature, mounted only once its flag is on.
 *
 * The flag is what the nav and the home screen read too, so a feature is
 * either reachable everywhere or nowhere — there is no state where the tab is
 * greyed out but the URL still opens a half-built screen. A farmer typing
 * `/scan` before Week 5 lands on the catch-all and goes home.
 */
const scanRoutes: RouteObject[] = FEATURES.scan.enabled
  ? [
      {
        path: 'scan',
        lazy: async () => {
          const { ScanPage } = await import('@/features/scan');
          return { Component: ScanPage };
        },
      },
    ]
  : [];

const priceRoutes: RouteObject[] = FEATURES.prices.enabled
  ? [
      {
        path: 'market',
        lazy: async () => {
          const { MarketPage } = await import('@/features/market');
          return { Component: MarketPage };
        },
      },
    ]
  : [];

// `import.meta.env.DEV` is the literal `false` in a production build, so this
// route and the chunk behind its dynamic import are dropped from it entirely.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/components',
        lazy: async () => {
          const { ComponentsPage } = await import('@/features/dev');
          return { Component: ComponentsPage };
        },
      },
    ]
  : [];

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: <LoginLayout />,
        children: [
          { index: true, element: <LanguagePage /> },
          { path: 'phone', element: <PhonePage /> },
          { path: 'verify', element: <VerifyPage /> },
        ],
      },
    ],
  },
  ...devRoutes,
  {
    element: <ProtectedRoute />,
    children: [
      {
        // Lazy, like every other feature route: the wizard pulls in
        // react-hook-form, which nothing on the sign-in path needs.
        path: '/onboarding',
        lazy: async () => {
          const { OnboardingPage } = await import('@/features/onboarding');
          return { Component: OnboardingPage };
        },
      },
      {
        element: <RequireProfile />,
        children: [
          {
            path: '/',
            element: <AppShell />,
            children: [
              {
                index: true,
                lazy: async () => {
                  const { HomePage } = await import('@/features/home');
                  return { Component: HomePage };
                },
              },
              {
                path: 'plots',
                lazy: async () => {
                  const { PlotsPage } = await import('@/features/plots');
                  return { Component: PlotsPage };
                },
              },
              {
                // `new` and `:id/edit` share one component. Order does not
                // matter -- react-router ranks the static segment above the
                // dynamic one however they are written.
                path: 'plots/new',
                lazy: async () => {
                  const { PlotFormPage } = await import('@/features/plots');
                  return { Component: PlotFormPage };
                },
              },
              {
                path: 'plots/:id/edit',
                lazy: async () => {
                  const { PlotFormPage } = await import('@/features/plots');
                  return { Component: PlotFormPage };
                },
              },
              {
                // The plot's crop calendar. Its own chunk: it pulls the task
                // sheet and react-hook-form with it, and the list screen does
                // not need either.
                path: 'plots/:id/calendar',
                lazy: async () => {
                  const { CalendarPage } = await import('@/features/calendar');
                  return { Component: CalendarPage };
                },
              },
              ...scanRoutes,
              ...priceRoutes,
              {
                path: 'profile',
                lazy: async () => {
                  const { ProfilePage } = await import('@/features/profile');
                  return { Component: ProfilePage };
                },
              },
            ],
          },
        ],
      },
      {
        // Deliberately outside AppShell: the officer portal is a desktop
        // surface and gets its own shell, not the farmer's navigation.
        path: '/officer',
        element: <RoleRoute allow={OFFICER_PORTAL_ROLES} />,
        children: [
          {
            element: <DesktopOnlyRoute />,
            children: [
              {
                index: true,
                lazy: async () => {
                  const { OfficerDashboardPage } = await import('@/features/officer');
                  return { Component: OfficerDashboardPage };
                },
              },
              { path: '*', element: <Navigate to="/officer" replace /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
