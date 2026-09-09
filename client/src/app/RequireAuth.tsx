import type { ReactNode, ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/features/auth';

export function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const token = useAuthStore((state) => state.token);
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
