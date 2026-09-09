import axios, { type AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { useAuthStore } from '@/features/auth/auth.store';

/**
 * Shared axios instance. Attaches the bearer token and an `X-Request-Id` that
 * the API echoes back, so a client-side failure can be traced to a server log
 * line by the same id.
 */
// An unset or empty VITE_API_BASE_URL means "use the Vite dev proxy", so an
// empty string has to fall back too -- `??` alone would not catch it.
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const baseURL =
  configuredBaseUrl !== undefined && configuredBaseUrl.length > 0 ? configuredBaseUrl : '/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const { token } = useAuthStore.getState();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['X-Request-Id'] = uuidv4();
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      useAuthStore.getState().signOut();
    }
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  },
);
