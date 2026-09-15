import { useLocation } from 'react-router-dom';

/** Router state a guarded route hands to `/login`, so sign-in can return there. */
export interface LoginRedirectState {
  from: string;
}

/**
 * Where to go after signing in. Only in-app paths are honoured: `//host` is
 * protocol-relative and would leave the origin, and `/login` would loop.
 */
export function getPostLoginPath(state: unknown): string {
  const from = (state as Partial<LoginRedirectState> | null)?.from;
  if (
    typeof from !== 'string' ||
    !from.startsWith('/') ||
    from.startsWith('//') ||
    from.startsWith('/login')
  ) {
    return '/';
  }
  return from;
}

/**
 * The state a guarded route attached when it sent this farmer to `/login`, for
 * a step to hand on to the next one. Narrowed from react-router's `any` to
 * `unknown` on the way out: the steps only carry it, `getPostLoginPath` reads
 * it, and nothing in between should be able to touch it unchecked.
 */
export function useLoginRedirectState(): unknown {
  return useLocation().state as unknown;
}
