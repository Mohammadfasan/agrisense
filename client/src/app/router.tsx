import { createBrowserRouter, Navigate } from 'react-router-dom';

import { LoginPage } from '@/features/auth';

import { AppLayout } from './AppLayout';
import { RequireAuth } from './RequireAuth';

/**
 * Feature routes are loaded on demand. The map (leaflet) and charts (recharts)
 * are the two heaviest dependencies in the app and neither is needed to sign in
 * or to open the scan screen — on a 3G connection that difference is seconds.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/farms" replace /> },
      {
        path: 'farms',
        lazy: async () => {
          const { FarmListPage } = await import('@/features/farm');
          return { Component: FarmListPage };
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
        path: 'officer',
        lazy: async () => {
          const { OfficerDashboardPage } = await import('@/features/officer');
          return { Component: OfficerDashboardPage };
        },
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
