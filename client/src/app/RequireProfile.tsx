import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore, type LoginRedirectState } from '@/features/auth';
import { Button, Spinner } from '@/shared/components';

/**
 * Holds a route until it is known whether this farmer has a profile, then
 * sends them to onboarding if they do not.
 *
 * Mounted inside `ProtectedRoute` in the router, but it re-checks the session
 * itself rather than assuming it: a session can end mid-render while this is
 * mounted, and a guard that only its parent protects is one refactor away from
 * being wrong.
 *
 * The order matters. `profileStatus` starts at `unknown` and routing on it
 * would send a farmer who *does* have a profile to re-enter it for as long as
 * the request took, so the bootstrap gate comes first.
 */
export function RequireProfile({ children }: { children?: ReactNode }): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const profileStatus = useAuthStore((state) => state.profileStatus);
  const fetchProfile = useAuthStore((state) => state.fetchProfile);

  // The silent refresh and the profile fetch both run inside `hydrate`, so
  // this covers the window in which neither answer has arrived.
  if (isBootstrapping) {
    return <FullPageSpinner label={t('common.loading', 'Loading')} />;
  }

  if (!isAuthenticated) {
    const state: LoginRedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    };
    return <Navigate to="/login" replace state={state} />;
  }

  if (profileStatus === 'none') {
    return <Navigate to="/onboarding" replace />;
  }

  // Bootstrap has finished and the answer is still not known, which means the
  // fetch failed on something other than "no profile" -- offline, most
  // likely. Deliberately not a spinner: this state does not resolve on its
  // own, and a farmer left watching one would have no way out. Deliberately
  // not onboarding either, which would ask them to retype a profile the
  // server may well already hold.
  if (profileStatus === 'unknown') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-base text-gray-900">
          {t('profile.loadFailed', 'Your profile could not be loaded. Check your connection.')}
        </p>
        <Button
          onClick={() => {
            void fetchProfile();
          }}
        >
          {t('common.retry', 'Try again')}
        </Button>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}

function FullPageSpinner({ label }: { label: string }): ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner size="lg" label={label} />
    </div>
  );
}
