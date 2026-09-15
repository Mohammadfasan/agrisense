import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { LanguagePage, LoginLayout, PhonePage, VerifyPage, type UserRole } from '@/features/auth';

import { AppShell } from './AppShell';
import { AuthLayout } from './AuthLayout';
import { DesktopOnlyRoute } from './DesktopOnlyRoute';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireProfile } from './RequireProfile';
import { RoleRoute } from './RoleRoute';

const OFFICER_PORTAL_ROLES: readonly UserRole[] = ['officer', 'admin'];

/**
 * Feature routes are loaded on demand. The map (leaflet) and charts (recharts)
 * are the two heaviest dependencies in the app and neither is needed to sign in
 * or to open the scan screen — on a 3G connection that difference is seconds.
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
 *   └── /officer/*  RoleRoute → DesktopOnlyRoute
 *   /dev/components             public; development builds only
 *
 * `RequireProfile` wraps the farmer subtree and not the officer portal:
 * officers have no farmer profile of their own, and `/onboarding` sits outside
 * it because it is where that guard sends people.
 */

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
                  const { FarmListPage } = await import('@/features/farm');
                  return { Component: FarmListPage };
                },
              },
              {
                path: 'plots/:id',
                lazy: async () => {
                  const { PlotDetailPage } = await import('@/features/farm');
                  return { Component: PlotDetailPage };
                },
              },
              {
                path: 'scan',
                lazy: async () => {
                  const { ScanPage } = await import('@/features/scan');
                  return { Component: ScanPage };
                },
              },
              {
                path: 'market',
                lazy: async () => {
                  const { MarketPage } = await import('@/features/market');
                  return { Component: MarketPage };
                },
              },
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
