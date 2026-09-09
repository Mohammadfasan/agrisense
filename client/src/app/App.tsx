import type { ReactElement } from 'react';
import { RouterProvider } from 'react-router-dom';

import { AppProviders } from './providers';
import { router } from './router';

export function App(): ReactElement {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
