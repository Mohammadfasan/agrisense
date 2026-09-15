import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// These two modules import each other: the API client reads tokens from this
// store, and this store calls the API. Neither touches the other at load time,
// only inside functions, so the cycle is safe for as long as that holds.
import { api, getApiErrorCode, getApiErrorDetails, refreshAccessToken } from '@/shared/api/client';

// Owns the stored language; this store only mirrors it. No cycle: i18n knows
// nothing about auth.
import { applyLanguage, hasChosenLanguage, type LanguageCode } from '@/shared/i18n';

import type {
  FarmerProfileInput,
  FarmerProfileRecord,
  FarmerProfileUpdateInput,
} from '@agrisense/shared';

/**
 * Whether this account has a farmer profile. `unknown` is the state before
 * anything has looked, and is deliberately distinct from `none`.
 */
export type ProfileStatus = 'unknown' | 'none' | 'complete';

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

/**
 * What S-03 has typed so far. Held here rather than in the screen because
 * stepping back to S-02 to correct a digit of the phone number unmounts the
 * route -- and a farmer who does that has not withdrawn the code they were
 * halfway through typing, or the name they had already given.
 */
export interface VerifyDraft {
  code: string;
  name: string;
  district: string;
}

const EMPTY_DRAFT: VerifyDraft = { code: '', name: '', district: '' };

interface AuthState {
  user: AuthUser | null;
  /**
   * Whether this farmer has picked a language themselves, as opposed to being
   * shown the one the browser was set to. Only this suppresses S-01 -- the
   * active language is `i18n.language`, and a detected guess is not an answer.
   *
   * Not part of the session: it survives sign-out, because the device still
   * belongs to the same person. Persisted by `@/shared/i18n`, which owns the
   * key; this is the copy the guards re-render on.
   */
  languageChosenByUser: boolean;
  /**
   * The farmer profile (`/farmers/me`), or `null` when there is none to show
   * -- either because none has been saved or because nothing has looked yet.
   * {@link profileStatus} is what tells those two apart.
   */
  profile: FarmerProfileRecord | null;
  /**
   * Whether this account has a profile.
   *
   * `unknown` until a fetch settles, and a guard must not act on it: routing
   * on `unknown` would send a farmer who has a profile to onboarding for as
   * long as the request takes. `none` is a fact -- the server answered
   * `PROFILE_NOT_FOUND` -- and not merely the absence of one.
   */
  profileStatus: ProfileStatus;
  /**
   * The OTP request in flight, which is what carries the phone number from
   * S-02 to S-03. `null` outside the code step.
   */
  otpChallenge: RequestOtpResult | null;
  /** Set when verify reports the number has no account yet, so S-03 asks for one. */
  needsProfile: boolean;
  /** Whatever S-03 has typed, so a step back and forward does not empty it. */
  verifyDraft: VerifyDraft;
  /**
   * When the server will accept another code request, as an ISO timestamp, or
   * `null` if nothing is holding one back.
   *
   * The limit is per phone number, so it belongs to the flow rather than to
   * whichever screen happened to be refused: S-02 and S-03 both ask for codes,
   * and stepping between them must not look like a way around it. Storing the
   * moment rather than the duration is what lets a screen count it down.
   */
  otpRetryAt: string | null;
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
  /**
   * True until `hydrate` settles, and no longer than that.
   *
   * Separate from {@link isLoading}, which also covers OTP calls and profile
   * saves: `RequireProfile` shows a full-page spinner off this flag, and
   * sharing `isLoading` would throw that spinner over the whole screen every
   * time the profile screen saved an edit.
   */
  isBootstrapping: boolean;

  /**
   * Records a choice: switches the UI immediately, remembers it for the next
   * launch, and marks the language as chosen rather than detected.
   */
  setLanguage: (code: LanguageCode) => void;
  /** Opens the code step on success. Rejects with the API's error. */
  requestOtp: (phone: string) => Promise<RequestOtpResult>;
  /**
   * Signs in on success. Rejects with the API's error. `PROFILE_REQUIRED` is
   * the one worth handling: it raises `needsProfile` rather than failing, and
   * the same code still works when it is sent back with a profile.
   */
  verifyOtp: (input: VerifyOtpInput) => Promise<AuthUser>;
  /**
   * Loads the profile and settles {@link profileStatus}. Resolves either way:
   * a missing profile is an answer, not a failure, and the guard needs both
   * outcomes to be a resolution rather than a rejection it has to catch.
   */
  fetchProfile: () => Promise<void>;
  /** `PUT` -- creates or replaces the whole profile. */
  saveProfile: (input: FarmerProfileInput) => Promise<FarmerProfileRecord>;
  /** `PATCH` -- sends only the fields given. */
  patchProfile: (patch: FarmerProfileUpdateInput) => Promise<FarmerProfileRecord>;
  /** Merges into the S-03 draft. The screen decides which fields it sets. */
  setVerifyDraft: (patch: Partial<VerifyDraft>) => void;
  /** Drops the code step and its phone number, sending the flow back to S-02. */
  resetLoginFlow: () => void;
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
  // The half-finished login attempt goes with the session. The language does
  // not: it is a property of the person holding the phone.
  otpChallenge: null,
  // The profile belongs to the account, so it goes with the session -- and
  // back to `unknown`, not `none`: nobody has asked about the next account.
  profile: null,
  profileStatus: 'unknown' as ProfileStatus,
  needsProfile: false,
  verifyDraft: EMPTY_DRAFT,
  otpRetryAt: null,
} satisfies Partial<AuthState>;

/**
 * The moment the server says it will take another request, when refusing one
 * for that reason. `undefined` for every other failure, which is what lets a
 * screen tell a dated rate limit apart from a flat refusal it has to spell out
 * itself.
 */
function getRetryAt(cause: unknown): string | undefined {
  if (getApiErrorCode(cause) !== 'OTP_RATE_LIMITED') {
    return undefined;
  }
  const seconds = getApiErrorDetails(cause)?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : undefined;
}

/**
 * Mirrors onto `user` the three fields the API copies from a saved profile
 * onto the farmer record.
 *
 * The server writes `fullName`, `district` and `preferredLanguage` through to
 * `farmers` on every save (see `farmerProfile.service.ts`). `user` is this
 * client's copy of that record, read by the profile screen and the shell, and
 * it is only otherwise refreshed on the next sign-in -- so without this a
 * farmer would correct their name and go on seeing the old one.
 */
function syncUserFromProfile(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
  profile: FarmerProfileRecord,
): void {
  const { user } = get();
  if (!user) {
    return;
  }
  set({
    user: {
      ...user,
      name: profile.fullName,
      district: profile.district,
      language: profile.preferredLanguage,
    },
  });
}

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
        languageChosenByUser: hasChosenLanguage(),
        isLoading: true,
        isBootstrapping: true,

        setLanguage: (code) => {
          applyLanguage(code);
          set({ languageChosenByUser: true });
        },

        requestOtp: (phone) =>
          track(async () => {
            let data: RequestOtpResult;
            try {
              ({ data } = await api.post<RequestOtpResult>(
                '/auth/otp/request',
                { phone },
                { skipAuth: true },
              ));
            } catch (cause) {
              // Set on a dated rate limit and cleared on anything else, so that
              // a non-null `otpRetryAt` always describes the call that just
              // failed rather than one refused minutes ago.
              set({ otpRetryAt: getRetryAt(cause) ?? null });
              throw cause;
            }
            // Holds the number as the server normalised it, which is the one
            // verify has to be given.
            set({
              otpChallenge: data,
              needsProfile: false,
              otpRetryAt: null,
              // The digits in the boxes belong to the code just replaced. The
              // name and district do not, and a farmer part-way through
              // registering keeps them.
              verifyDraft: { ...get().verifyDraft, code: '' },
            });
            return data;
          }),

        verifyOtp: (input) =>
          track(async () => {
            try {
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
                otpChallenge: null,
                needsProfile: false,
                // The login flow is over, and the draft holds a code that has
                // just been spent. Nothing should be able to read it back.
                verifyDraft: EMPTY_DRAFT,
                otpRetryAt: null,
              });
              return data.user;
            } catch (cause) {
              // The server checks for an account before spending the code, so
              // the same code still works once the profile comes back with it.
              if (getApiErrorCode(cause) === 'PROFILE_REQUIRED') {
                set({ needsProfile: true });
              }
              throw cause;
            }
          }),

        fetchProfile: async () => {
          // Officers and admins have no farmer profile, and asking for one
          // would 403. Settling them as `none` would send them to onboarding,
          // so they settle as `complete`: there is nothing outstanding.
          const role = get().user?.role;
          if (role !== undefined && role !== 'farmer') {
            set({ profile: null, profileStatus: 'complete' });
            return;
          }

          try {
            const { data } = await api.get<{ profile: FarmerProfileRecord }>('/farmers/me');
            set({ profile: data.profile, profileStatus: 'complete' });
          } catch (cause) {
            // Only the server saying so makes it `none`. A timeout or a dead
            // connection leaves the status `unknown`, because the profile may
            // well exist -- and the guard holds rather than sending a farmer
            // to re-enter details they have already given.
            if (getApiErrorCode(cause) === 'PROFILE_NOT_FOUND') {
              set({ profile: null, profileStatus: 'none' });
              return;
            }
            set({ profileStatus: get().profile === null ? 'unknown' : 'complete' });
          }
        },

        saveProfile: (input) =>
          track(async () => {
            const { data } = await api.put<{ profile: FarmerProfileRecord }>('/farmers/me', input);
            set({ profile: data.profile, profileStatus: 'complete' });
            syncUserFromProfile(set, get, data.profile);
            return data.profile;
          }),

        patchProfile: (patch) =>
          track(async () => {
            const { data } = await api.patch<{ profile: FarmerProfileRecord }>(
              '/farmers/me',
              patch,
            );
            set({ profile: data.profile, profileStatus: 'complete' });
            syncUserFromProfile(set, get, data.profile);
            return data.profile;
          }),

        setVerifyDraft: (patch) => {
          set((state) => ({ verifyDraft: { ...state.verifyDraft, ...patch } }));
        },

        resetLoginFlow: () => {
          // A different number is a different farmer as far as this flow knows,
          // so the draft goes with the challenge.
          set({
            otpChallenge: null,
            needsProfile: false,
            verifyDraft: EMPTY_DRAFT,
            otpRetryAt: null,
          });
        },

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

                // Awaited inside the same hydration, so `isLoading` is still
                // true while it runs: `RequireProfile` shows its spinner off
                // that flag, which is what keeps `profileStatus` from being
                // read as `unknown` on the first render and bouncing a farmer
                // who does have a profile. Only for a session that survived
                // the refresh -- a logout above clears `isAuthenticated`.
                if (get().isAuthenticated) {
                  await get().fetchProfile();
                }
              }
            } finally {
              set({ isBootstrapping: false });
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
