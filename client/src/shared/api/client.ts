import axios, { type AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { useAuthStore, type AuthTokens } from '@/features/auth/authStore';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Set on the single replay after a refresh, so a second 401 is final. */
    _retried?: boolean;
    /**
     * Send without a bearer token, and never refresh. For the OTP endpoints,
     * where a 401 means a wrong code rather than an expired session.
     */
    skipAuth?: boolean;
  }
}

// An unset or empty VITE_API_URL means "use the Vite dev proxy", so an
// empty string has to fall back too -- `??` alone would not catch it.
const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim();
const baseURL =
  configuredBaseUrl !== undefined && configuredBaseUrl.length > 0 ? configuredBaseUrl : '/api/v1';

const REFRESH_PATH = '/auth/refresh';

/** Refresh responses that mean the session is over, rather than the call failed. */
const SESSION_REJECTED = new Set([400, 401, 403]);

function createInstance(): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Shared axios instance. Attaches the bearer token and an `X-Request-Id` that
 * the API echoes back, so a client-side failure can be traced to a server log
 * line by the same id.
 */
export const api: AxiosInstance = createInstance();

/**
 * The refresh call goes through its own bare instance. None of `api`'s
 * interceptors run on it, so a 401 from the refresh endpoint cannot start
 * another refresh.
 */
const refreshClient: AxiosInstance = createInstance();

let sessionExpiredHandler: (() => void) | null = null;

/**
 * Registers what happens when the session cannot be renewed, after auth state
 * is cleared. This module sits below the router, so the app passes the
 * redirect in rather than this importing it.
 */
export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler;
}

/** The `code` from the API's error envelope, when the error is an API response. */
export function getApiErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const body = error.response?.data as { error?: { code?: unknown } } | null | undefined;
  const code = body?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

api.interceptors.request.use(async (config) => {
  config.headers['X-Request-Id'] = uuidv4();
  if (config.skipAuth === true) {
    return config;
  }

  let { accessToken } = useAuthStore.getState();
  // The access token is held in memory only, so after a reload or an offline
  // start there is none until a refresh succeeds. Get one first: a request
  // sent without a token would 401, and the response handler rightly does not
  // retry requests that carried no token.
  if (!accessToken && useAuthStore.getState().refreshToken) {
    accessToken = await refreshAccessToken();
  }
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    const { config } = error;
    const sentAuthorization = config.headers.Authorization;
    const { accessToken } = useAuthStore.getState();

    if (
      config._retried === true ||
      // The refresh call uses `refreshClient`, but nothing stops someone
      // posting to the endpoint through `api`.
      config.url?.endsWith(REFRESH_PATH) === true ||
      // A 401 on a request that sent no token is a real answer, not an
      // expired session.
      sentAuthorization === undefined ||
      // Signed out while this request was in flight.
      accessToken === null
    ) {
      throw error;
    }

    config._retried = true;

    // Sent before the last refresh landed, so it carried the old token. That
    // refresh already happened; replay with the new token, don't start another.
    if (sentAuthorization !== `Bearer ${accessToken}`) {
      return api(config);
    }

    if ((await refreshAccessToken()) === null) {
      throw error;
    }
    // The request interceptor attaches the renewed token on the way out.
    return api(config);
  },
);

/**
 * The refresh in progress, if any. Every 401 in a burst awaits this one
 * promise, so N failed requests cost one refresh.
 *
 * "Exactly one" is a correctness requirement, not an optimisation: the server
 * rotates refresh tokens and treats a second use of the same token as theft,
 * revoking the whole session. Two parallel refreshes would sign the user out.
 */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the stored refresh token for a new pair, joining any refresh
 * already in flight. Anything that refreshes must come through here.
 *
 * Resolves to the new access token, or `null` when the server refused the
 * token (the session has been ended) or could not be reached (it has not).
 * Never rejects.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= requestNewTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function requestNewTokens(): Promise<string | null> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    endSession();
    return null;
  }

  let tokens: AuthTokens;
  try {
    const response = await refreshClient.post<{ tokens: AuthTokens }>(
      REFRESH_PATH,
      { refreshToken },
      { headers: { 'X-Request-Id': uuidv4() } },
    );
    tokens = response.data.tokens;
  } catch (refreshError) {
    // Only the server refusing the token ends the session. Losing signal or a
    // 5xx is not the user's doing, and signing a farmer out for it would lock
    // their offline work behind a login that needs a connection to complete.
    const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
    if (status !== undefined && SESSION_REJECTED.has(status)) {
      endSession();
    }
    return null;
  }

  // Signed out, or back in as someone else, while the refresh was in flight.
  // That newer state wins; these tokens belong to a session that has ended.
  if (useAuthStore.getState().refreshToken !== refreshToken) {
    return null;
  }

  useAuthStore.getState().setTokens(tokens);
  return tokens.accessToken;
}

function endSession(): void {
  useAuthStore.getState().logout();
  sessionExpiredHandler?.();
}
