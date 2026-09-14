import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode, type ReactElement } from 'react';

import { queryClient } from './queryClient';

// Development only. Behind `import.meta.env.DEV` the import is dead code in a
// production build, so the devtools never reach a farmer's download.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const { ReactQueryDevtools: Devtools } = await import('@tanstack/react-query-devtools');
      return { default: Devtools };
    })
  : null;

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools && (
        <Suspense fallback={null}>
          {/* Top corner: the default bottom-right sits on the bottom nav. */}
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
