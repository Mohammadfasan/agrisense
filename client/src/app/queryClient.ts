import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { useAuthStore } from '@/features/auth';

const MAX_QUERY_RETRIES = 1;

/**
 * One retry, and only for failures another attempt could fix. A 4xx is the
 * server's answer rather than a blip, so asking again gets the same answer —
 * and an expired token never shows up here as a 401, because the API client
 * refreshes and replays those itself. Offline, retrying just burns battery.
 */
function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES || !navigator.onLine) {
    return false;
  }
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status === undefined || status >= 500;
}

/**
 * Defaults tuned for intermittent rural connectivity: cached data stays usable
 * for a long time, and a failed request is not retried into oblivion while the
 * device is offline.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Writes are not safe to repeat blindly; the outbox in `@/db/sync` owns
      // retrying them, with the idempotency that needs.
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});

// Phones get shared. Whoever signs in next, or nobody, must not be shown the
// last user's cached data. Keyed on the user id so a token rotation leaves the
// cache alone.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    queryClient.clear();
  }
});
