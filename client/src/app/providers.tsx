import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode, ReactElement } from 'react';

import { queryClient } from './queryClient';

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
