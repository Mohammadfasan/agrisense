import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from './authStore';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getPostLoginPath, useLoginRedirectState } from './redirect';

/**
 * The `/login` subtree: language (S-01) → phone (S-02) → code (S-03).
 *
 * Each screen is its own route so the back button works and a step can be
 * linked to, and each guards its own entry condition -- there is no step
 * counter to keep in sync, only the auth store's state. Reachable states:
 *
 *   /login          no language chosen yet; otherwise forwards to /login/phone
 *   /login/phone    a language is set
 *   /login/verify   a code has been requested (`otpChallenge`)
 *
 * Signing in is caught here rather than in the screen that did it, so it works
 * whichever step lands it -- including arriving already signed in.
 *
 * The language switcher lives here too, above the `Outlet`, so it is on every
 * step rather than only the first -- and so switching re-renders the step in
 * place instead of remounting it, which is what lets a half-typed phone number
 * survive the switch.
 */
export function LoginLayout(): ReactElement {
  const redirectState = useLoginRedirectState();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const languageChosenByUser = useAuthStore((state) => state.languageChosenByUser);

  if (isAuthenticated) {
    return <Navigate to={getPostLoginPath(redirectState)} replace />;
  }

  // The redirect state carries the page a guard bounced the farmer off, and the
  // steps hand it along so it survives to the redirect above.
  return (
    <div className="flex flex-col gap-6">
      {/* Hidden on S-01, which is the full-screen picker: a second, smaller
          copy of the same choice above it would only be in the way. A chosen
          language is exactly what S-01 forwards away from, so the flag doubles
          as "past the first step" without this layout matching on the path. */}
      {languageChosenByUser && (
        <div className="flex justify-center lg:justify-end">
          <LanguageSwitcher />
        </div>
      )}
      <Outlet />
    </div>
  );
}
