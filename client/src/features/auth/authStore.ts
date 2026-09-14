import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// These two modules import each other: the API client reads tokens from this
// store, and this store calls the API. Neither touches the other at load time,
// only inside functions, so the cycle is safe for as long as that holds.
import { api, refreshAccessToken } from '@/shared/api/client';

/** Mirrors `FARMER_ROLES` in `server/src/models/farmer.model.ts`. */
export type UserRole = 'farmer' | 'officer' | 'market_admin' | 'admin';

/** Mirrors `RequestUser` in `server/src/modules/auth/auth.types.ts`. */
export interface AuthUser {
  id: string;
  phone: string;
  name: string;
  role: UserRole;
  language: string;
  district: string;
  dsDivision?: string;
  /** Officers only; empty for everyone else. */
  assignedDistricts: string[];
}

/** The pair the server issues on verify and rotates on every refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RequestOtpResult {
  /** The number as the server normalised it; send this one to verify. */
  phone: string;
  expiresAt: string;
  expiresInSeconds: number;
  requestsRemaining: number;
  /** Only present when the server runs with `OTP_DEV_MODE`. */
  devCode?: string;
}

/** Sent with the code on first login, when no account exists for the number. */
export interface FarmerProfile {
  name: string;
  district: string;
  language?: string;
  dsDivision?: string;
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
  profile?: FarmerProfile;
}

interface AuthState {
  user: AuthUser | null;
  /** Memory only. Gone after a reload until `hydrate` fetches a new one. */
  accessToken: string | null;
  /** Persisted. The credential that carries a session across reloads. */
  refreshToken: string | null;
  /**
   * There is a session: a user and a refresh token. Not the same as holding an
   * access token — after an offline start there is a session but no token.
   */
  isAuthenticated: boolean;
  /** True until `hydrate` settles, and while an OTP call is in flight. */
  isLoading: boolean;

  /** Rejects with the API's error; nothing in the store changes either way. */
  requestOtp: (phone: string) => Promise<RequestOtpResult>;
  /** Signs in on success. Rejects with the API's error, e.g. `PROFILE_REQUIRED`. */
  verifyOtp: (input: VerifyOtpInput) => Promise<AuthUser>;
  logout: () => void;
  /** Renews the access token for a restored session. Call once at startup. */
  hydrate: () => Promise<void>;
  /** For the API client, to swap in a rotated pair. The user is unchanged. */
  setTokens: (tokens: AuthTokens) => void;
}

type PersistedAuth = Pick<AuthState, 'refreshToken' | 'user'>;

const SIGNED_OUT = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
} satisfies Partial<AuthState>;

/**
 * Auth operations in flight. Starts at 1 because the session is unconfirmed
 * until `hydrate` settles. A counter rather than a flag, so an OTP call that
 * finishes first cannot clear `isLoading` while hydration is still running.
 */
let pending = 1;

/** One hydration per page load, however many callers ask for it. */
let hydration: Promise<void> | null = null;

/**
 * The refresh token and user are persisted so a farmer who opens the app
 * offline is still signed in. The access token never touches disk: it is the
 * one that authorises API calls, and it is cheap to get another.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const settle = (): void => {
        pending -= 1;
        set({ isLoading: pending > 0 });
      };

      const track = async <T>(work: () => Promise<T>): Promise<T> => {
        pending += 1;
        set({ isLoading: true });
        try {
          return await work();
        } finally {
          settle();
        }
      };

      return {
        ...SIGNED_OUT,
        isLoading: true,

        requestOtp: (phone) =>
          track(async () => {
            const { data } = await api.post<RequestOtpResult>(
              '/auth/otp/request',
              { phone },
              { skipAuth: true },
            );
            return data;
          }),

        verifyOtp: (input) =>
          track(async () => {
            const { data } = await api.post<{ user: AuthUser; tokens: AuthTokens }>(
              '/auth/otp/verify',
              input,
              { skipAuth: true },
            );
            set({
              user: data.user,
              accessToken: data.tokens.accessToken,
              refreshToken: data.tokens.refreshToken,
              isAuthenticated: true,
            });
            return data.user;
          }),

        logout: () => {
          set(SIGNED_OUT);
        },

        hydrate: () => {
          hydration ??= (async () => {
            try {
              if (get().isAuthenticated) {
                // Shares the API client's single-flight refresh; two refreshes
                // racing with one token would trip reuse detection. If the
                // server refuses the token, the client has already logged out.
                // If it cannot be reached, the session stands.
                await refreshAccessToken();
              }
            } finally {
              settle();
            }
          })();
          return hydration;
        },

        setTokens: ({ accessToken, refreshToken }) => {
          set({ accessToken, refreshToken });
        },
      };
    },
    {
      name: 'agrisense.auth',
      partialize: (state): PersistedAuth => ({
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      // Picks fields rather than spreading, so a token written by an older
      // build (which persisted the access token) is not restored into memory.
      merge: (persisted, current) => {
        const { refreshToken, user } = (persisted ?? {}) as Partial<PersistedAuth>;
        if (typeof refreshToken !== 'string' || user == null) {
          return current;
        }
        return { ...current, refreshToken, user, isAuthenticated: true };
      },
    },
  ),
);
