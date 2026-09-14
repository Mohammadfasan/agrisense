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
