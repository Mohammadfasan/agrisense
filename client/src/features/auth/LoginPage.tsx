import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { getApiErrorCode } from '@/shared/api/client';
import { SUPPORTED_LANGUAGES } from '@/shared/i18n';

import { useAuthStore, type FarmerProfile } from './authStore';
import { getPostLoginPath } from './redirect';

type Step = 'phone' | 'code';

type Message = readonly [key: string, fallback: string];

/** Keyed by the server's `ErrorCode`. */
const ERROR_MESSAGES: Record<string, Message> = {
  VALIDATION_ERROR: ['auth.error.validation', 'Check the details and try again.'],
  OTP_RATE_LIMITED: ['auth.error.rateLimited', 'Too many codes requested. Try again later.'],
  OTP_INVALID: ['auth.error.invalid', 'That code is incorrect.'],
  OTP_EXPIRED: ['auth.error.expired', 'That code has expired. Request a new one.'],
  OTP_ATTEMPTS_EXCEEDED: ['auth.error.attempts', 'Too many attempts. Request a new code.'],
  ACCOUNT_INACTIVE: ['auth.error.inactive', 'This account is no longer active.'],
};

const GENERIC_ERROR: Message = [
  'auth.error.generic',
  'Something went wrong. Check your connection and try again.',
];

export function LoginPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const verifyOtp = useAuthStore((state) => state.verifyOtp);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Covers both arriving signed in and a successful verify below.
  if (isAuthenticated) {
    return <Navigate to={getPostLoginPath(location.state)} replace />;
  }

  const showError = (cause: unknown): void => {
    const [key, fallback] = ERROR_MESSAGES[getApiErrorCode(cause) ?? ''] ?? GENERIC_ERROR;
    setError(t(key, fallback));
  };

  const handleRequestCode = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      const result = await requestOtp(phone);
      setPhone(result.phone);
      setDevCode(result.devCode);
      setCode('');
      setStep('code');
    } catch (cause) {
      showError(cause);
    }
  };

  const handleVerify = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    const language = SUPPORTED_LANGUAGES.some((lang) => lang.code === i18n.language)
      ? { language: i18n.language }
      : {};
    const profile: FarmerProfile = { name, district, ...language };
    try {
      await verifyOtp({ phone, code, ...(needsProfile ? { profile } : {}) });
    } catch (cause) {
      // The server checks for an account before spending the code, so the
      // same code still works once the profile is filled in.
      if (getApiErrorCode(cause) === 'PROFILE_REQUIRED') {
        setNeedsProfile(true);
        return;
      }
      showError(cause);
    }
  };

  const startOver = (): void => {
    setStep('phone');
    setCode('');
    setDevCode(undefined);
    setNeedsProfile(false);
    setError(null);
  };

  return (
    // Centering and the brand come from `AuthLayout`.
    <div className="flex flex-col gap-6">
      <h2 className="text-center text-xl font-semibold lg:text-left lg:text-2xl">
        {t('auth.title', 'Sign in')}
      </h2>

      {step === 'phone' ? (
        <form
          onSubmit={(event) => {
            void handleRequestCode(event);
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('auth.phone', 'Phone number')}
            <input
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              className="min-h-touch rounded-lg border border-muted-300 px-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {t('auth.sendCode', 'Send code')}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            void handleVerify(event);
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted">
            {t('auth.codeSent', { defaultValue: 'Enter the code sent to {{phone}}', phone })}
          </p>
          {devCode !== undefined && (
            <p className="rounded-lg border border-dashed border-muted-300 px-3 py-2 text-sm">
              {t('auth.devCode', { defaultValue: 'Dev mode code: {{code}}', code: devCode })}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            {t('auth.code', 'Verification code')}
            <input
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,10}"
              required
              className="min-h-touch rounded-lg border border-muted-300 px-3 tracking-widest"
            />
          </label>

          {needsProfile && (
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm text-muted">
                {t(
                  'auth.newAccount',
                  'No account uses this number yet. Add your details to create one.',
                )}
              </legend>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth.name', 'Name')}
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  autoComplete="name"
                  required
                  className="min-h-touch rounded-lg border border-muted-300 px-3"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('auth.district', 'District')}
                <input
                  value={district}
                  onChange={(event) => {
                    setDistrict(event.target.value);
                  }}
                  required
                  className="min-h-touch rounded-lg border border-muted-300 px-3"
                />
              </label>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {needsProfile ? t('auth.createAccount', 'Create account') : t('auth.signIn', 'Sign in')}
          </button>
          <button type="button" className="btn-ghost" onClick={startOver}>
            {t('auth.changeNumber', 'Use a different number')}
          </button>
        </form>
      )}

      <div className="flex justify-center gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => {
              void i18n.changeLanguage(lang.code);
            }}
            className={[
              'btn-ghost px-3',
              i18n.language === lang.code ? 'text-primary font-medium' : '',
            ].join(' ')}
          >
            {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
