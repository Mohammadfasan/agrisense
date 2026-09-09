import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults tuned for intermittent rural connectivity: cached data stays usable
 * for a long time, and a failed request is not retried into oblivion while the
 * device is offline (the outbox in `@/db/sync` owns retrying writes).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount) => navigator.onLine && failureCount < 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
});
