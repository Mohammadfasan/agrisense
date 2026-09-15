import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { Button, Input } from '@/shared/components';

import { useAuthStore } from './authStore';
import { getAuthErrorMessage } from './errors';
import { formatWait, useSecondsRemaining } from './otp';
import {
  PHONE_COUNTRY_CODE,
  PHONE_INVALID_MESSAGE,
  PHONE_NATIONAL_DIGITS,
  phoneNationalSchema,
  toE164,
  toNationalDigits,
} from './phone';
import { useLoginRedirectState } from './redirect';

/**
 * What the screen is doing, and why any message under the field is there.
 *
 * `invalid` is the number's shape, caught here before a request is made;
 * `error` is the server's answer to one that was. They read the same to a
 * farmer but they are not the same thing, and only the first is worth
 * re-checking on every keystroke.
 */
type PhoneState =
  | { status: 'idle' }
  | { status: 'invalid'; message: string }
  | { status: 'submitting' }
  | { status: 'error'; message: string };

const IDLE: PhoneState = { status: 'idle' };

/** S-02 — phone entry. Requests the code, then hands off to S-03. */
export function PhonePage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const redirectState = useLoginRedirectState();
  const languageChosenByUser = useAuthStore((state) => state.languageChosenByUser);
  const otpChallenge = useAuthStore((state) => state.otpChallenge);
  const otpRetryAt = useAuthStore((state) => state.otpRetryAt);
  const requestOtp = useAuthStore((state) => state.requestOtp);

  // Only the national part. The dialling code is fixed and lives in the field
  // as a prefix, so there is nothing in here for a farmer to get wrong except
  // their own number.
  const [national, setNational] = useState(() =>
    // Back from the code screen comes here to fix a digit, not to start again,
    // so the number that was sent is put back in the field. The store holds it
    // in E.164; the same cleanup that handles a pasted number strips the code.
    otpChallenge === null ? '' : toNationalDigits(otpChallenge.phone),
  );
  const [state, setState] = useState<PhoneState>(IDLE);
  // The limit belongs to the number, not to this screen, so it is still in
  // force for a farmer who was refused on S-03 and stepped back here.
  const retryIn = useSecondsRemaining(otpRetryAt ?? undefined);

  // Every farmer picks a language before signing in (US-02), including one who
  // deep-links straight here. S-01 sends them back the other way once they do,
  // so the two guards cannot bounce off each other.
  if (!languageChosenByUser) {
    return <Navigate to="/login" replace state={redirectState} />;
  }

  const isSubmitting = state.status === 'submitting';
  /**
   * A refused request answered with the wait it asked for, counting down.
   * "Try again later" is not something a farmer can plan around, and the
   * number the server gave is wrong a minute after it gave it.
   */
  const retryNotice =
    retryIn > 0
      ? t('auth.error.rateLimitedFor', {
          defaultValue: 'Too many codes requested. Try again {{when}}.',
          when: formatWait(retryIn, i18n.language),
        })
      : undefined;
  const message =
    retryNotice ??
    (state.status === 'invalid' || state.status === 'error' ? state.message : undefined);

  const handleChange = (value: string): void => {
    const digits = toNationalDigits(value);
    setNational(digits);
    setState((current) => {
      // A server error is about the number that was sent, not the one being
      // typed now, so any edit clears it.
      if (current.status === 'error') {
        return IDLE;
      }
      // Once the shape has been called out, take it back the moment it is
      // fixed -- but never start complaining mid-way through a first attempt.
      if (current.status === 'invalid' && phoneNationalSchema.safeParse(digits).success) {
        return IDLE;
      }
      return current;
    });
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const parsed = phoneNationalSchema.safeParse(national);
    if (!parsed.success) {
      setState({ status: 'invalid', message: t('auth.phone.invalid', PHONE_INVALID_MESSAGE) });
      return;
    }

    setState({ status: 'submitting' });
    try {
      await requestOtp(toE164(parsed.data));
      // Not `replace`: going back from the code screen to correct a mistyped
      // number is a normal thing to want.
      navigate('/login/verify', { state: redirectState });
    } catch (cause) {
      // A dated rate limit is shown from the store, live; repeating it here in
      // a form that goes stale would only contradict it a minute later.
      setState(
        useAuthStore.getState().otpRetryAt === null
          ? { status: 'error', message: getAuthErrorMessage(cause, t) }
          : IDLE,
      );
    }
  };

  return (
    <>
      <h2 className="text-center text-xl font-semibold lg:text-left lg:text-2xl">
        {t('auth.phone.title', 'Sign in')}
      </h2>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        // The schema owns validation. Without this the browser's own bubble
        // fires first on an empty field, in the browser's language rather than
        // the farmer's, and never reaches the states below.
        noValidate
        className="flex flex-col gap-4"
      >
        <Input
          label={t('auth.phone.label', 'Mobile number')}
          hint={t('auth.phone.hint', 'A Sri Lankan mobile number, starting with 7.')}
          prefix={PHONE_COUNTRY_CODE}
          value={national}
          onChange={(event) => {
            handleChange(event.target.value);
          }}
          type="tel"
          // `numeric` rather than `tel`: the field takes digits and nothing
          // else, so the plain number pad beats the phone keypad's * and #.
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="7X XXX XXXX"
          maxLength={PHONE_NATIONAL_DIGITS}
          disabled={isSubmitting}
          autoFocus
          required
          className="tracking-wider"
          {...(message === undefined ? {} : { error: message })}
        />

        <div className="flex flex-col gap-2">
          <Button type="submit" loading={isSubmitting} disabled={retryIn > 0}>
            {t('auth.phone.submit', 'Send code')}
          </Button>
          <p className="text-center text-sm text-muted">
            {t('auth.phone.privacy', 'Your number is only used to sign you in.')}
          </p>
        </div>
      </form>
    </>
  );
}
