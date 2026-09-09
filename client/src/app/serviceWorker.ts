import { Workbox } from 'workbox-window';

/**
 * Registers the generated service worker and prompts before activating an
 * update, so a farmer mid-scan is never reloaded out from under.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
    return;
  }

  const wb = new Workbox('/sw.js', { scope: '/' });

  wb.addEventListener('waiting', () => {
    // Replace with an in-app prompt once the update UI exists.
    const shouldUpdate = window.confirm('A new version of AgriSense is available. Reload now?');
    if (!shouldUpdate) {
      return;
    }
    wb.addEventListener('controlling', () => {
      window.location.reload();
    });
    wb.messageSkipWaiting();
  });

  void wb.register();
}
