import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'farmer' | 'officer' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
}

/**
 * Persisted so a farmer who opens the app offline is still signed in. Token
 * expiry is enforced server-side; the 401 interceptor clears this on rejection.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      signIn: (token, user) => {
        set({ token, user });
      },
      signOut: () => {
        set({ token: null, user: null });
      },
    }),
    { name: 'agrisense.auth' },
  ),
);
