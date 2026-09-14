import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `lg` breakpoint — the officer portal's minimum width. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** Tracks a CSS media query, re-rendering when it starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => {
        mql.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
