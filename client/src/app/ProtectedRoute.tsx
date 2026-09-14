import type { ReactNode, ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore, type LoginRedirectState } from '@/features/auth';

/**
 * Sends signed-out users to `/login`, remembering where they were headed.
 * Renders `children` when given, otherwise the matched child route.
 *
 * Checks the session, not the access token. The token lives in memory only,
 * so after a reload there is none until `hydrate` renews it, and offline there
 * may be none at all. Waiting for it would bounce every deep link through
 * `/login` or lock a farmer out of their offline data. The API client fetches
 * a token before any request that needs one, and a session the server refuses
 * is ended there, which lands back here signed out.
 *
 * The session hydrates from localStorage synchronously, so it is known on
 * first render. Moving it to async storage would need a hydration gate here.
 */
export function ProtectedRoute({ children }: { children?: ReactNode }): ReactElement {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    const state: LoginRedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to="/login" replace state={state} />;
  }

  return <>{children ?? <Outlet />}</>;
}
