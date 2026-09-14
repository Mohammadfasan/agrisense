import type { ReactNode, ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore, type UserRole } from '@/features/auth';

interface RoleRouteProps {
  allow: readonly UserRole[];
  children?: ReactNode;
}

/**
 * Admits only the given roles; everyone else goes back to `/`. Mount inside
 * {@link ProtectedRoute} — this checks role, not sign-in.
 *
 * This is navigation, not security: the API enforces the same roles with
 * `authorise()`, and that is the check that counts.
 */
export function RoleRoute({ allow, children }: RoleRouteProps): ReactElement {
  const role = useAuthStore((state) => state.user?.role);

  if (!role || !allow.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children ?? <Outlet />}</>;
}
