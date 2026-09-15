import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { router } from '@/app/router';
import { registerServiceWorker } from '@/app/serviceWorker';
import { useAuthStore, type LoginRedirectState } from '@/features/auth';
import { onSessionExpired } from '@/shared/api/client';
import '@/shared/i18n';
import '@/shared/styles/index.css';

// Auth state is already cleared by the time this runs; send the user to sign
// in, and back to where they were afterwards.
onSessionExpired(() => {
  const { pathname, search, hash } = router.state.location;
  // Anywhere in the sign-in flow, not just its first step.
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return;
  }
  const state: LoginRedirectState = { from: `${pathname}${search}${hash}` };
  void router.navigate('/login', { replace: true, state });
});

// Renew the access token for a session restored from storage. Registered after
// the expiry handler, so a refused token redirects. Not awaited: a signed-in
// farmer sees the app at once, offline included, and any request that needs
// the token waits on this same refresh.
void useAuthStore.getState().hydrate();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
