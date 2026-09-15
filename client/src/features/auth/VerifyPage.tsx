import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { getApiErrorCode } from '@/shared/api/client';
import { Button, Input } from '@/shared/components';
import { getActiveLanguage } from '@/shared/i18n';
import { cx } from '@/shared/utils/cx';

import { useAuthStore, type FarmerProfile } from './authStore';
import { getAuthErrorMessage } from './errors';
import {
  formatCountdown,
  formatWait,
  OTP_CODE_LENGTH,
  toCodeDigits,
  useSecondsRemaining,
} from './otp';
import { OtpInput } from './OtpInput';
import { useLoginRedirectState } from './redirect';

/** What the screen is doing. Everything else on it is derived or remembered. */
type Status = 'idle' | 'verifying' | 'resending';

/** Why this code can no longer be used, once the server has said so. */
type Finished = 'expired' | 'locked';

/**
 * S-03 -- code entry, and the profile fields when the number is new. Both live
 * on one screen because the server only reveals that an account is missing
 * once a code is submitted, and the same code stays valid for the retry.
 *
 * Three things vary independently here, so they are three pieces of state
 * rather than one union: what the screen is doing, the last thing the server
 * said, and whether the code is finished. A resend that is refused has to show
 * its own message without clearing the expiry that prompted it, and the
 * countdown reaches zero without anyone having been asked anything at all.
 */
export function VerifyPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const redirectState = useLoginRedirectState();
  const otpChallenge = useAuthStore((state) => state.otpChallenge);
  const needsProfile = useAuthStore((state) => state.needsProfile);
  const otpRetryAt = useAuthStore((state) => state.otpRetryAt);
  const requestOtp = useAuthStore((state) => state.requestOtp);
  const verifyOtp = useAuthStore((state) => state.verifyOtp);
  const resetLoginFlow = useAuthStore((state) => state.resetLoginFlow);
  // Not local state: stepping back to S-02 to fix a digit of the number
  // unmounts this route, and coming back must not find the form empty.
  const { code, name, district } = useAuthStore((state) => state.verifyDraft);
  const setVerifyDraft = useAuthStore((state) => state.setVerifyDraft);

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);

  const secondsLeft = useSecondsRemaining(otpChallenge?.expiresAt);
  const retryIn = useSecondsRemaining(otpRetryAt ?? undefined);
  const countdownId = useId();

  // Nothing to verify -- a reload, or a deep link straight to this step. Below
  // the hooks, which have to run on every render including this one.
  if (otpChallenge === null) {
    return <Navigate to="/login/phone" replace state={redirectState} />;
  }

  const { phone, devCode } = otpChallenge;

  const isBusy = status !== 'idle';
  // The countdown is the client's own reading of an expiry the server set, so
  // either can be first to call it: a phone clock running fast, or a verify
  // that comes back `OTP_EXPIRED` with seconds still showing.
  const ending: Finished | null = finished ?? (secondsLeft === 0 ? 'expired' : null);
  // Empty and partial codes leave this false, which is the whole difference
  // those two states make: there is nothing to submit yet.
  const canSubmit = !isBusy && ending === null && code.length === OTP_CODE_LENGTH;
  // Held back until the code runs out, so a farmer waiting on a slow SMS does
  // not spend all three requests in the first minute. A code the server has
  // already finished with opens it early: there is nothing left to wait for.
  const canResend = !isBusy && ending !== null && retryIn === 0;

  /**
   * A refused request answered with the wait it asked for. "Try again later"
   * is not something a farmer can plan around -- whether to keep the phone in
   * hand or go back to work turns on whether it is one minute or forty -- and
   * a number that was right when the request was refused is wrong a minute
   * later, so it counts down rather than sitting there.
   */
  const retryNotice =
    retryIn > 0
      ? t('auth.error.rateLimitedFor', {
          defaultValue: 'Too many codes requested. Try again {{when}}.',
          when: formatWait(retryIn, i18n.language),
        })
      : null;

  const notice =
    message ??
    (ending === 'locked'
      ? t('auth.error.attempts', 'Too many attempts. Request a new code.')
      : ending === 'expired'
        ? t('auth.error.expired', 'That code has expired. Request a new one.')
        : null);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setMessage(null);
    setStatus('verifying');
    // Read at submit time, so a switch from the header a moment ago is the one
    // the new account is created with.
    const profile: FarmerProfile = { name, district, language: getActiveLanguage() };
    try {
      // Signing in is what ends the flow; `LoginLayout` redirects on it.
      await verifyOtp({ phone, code, ...(needsProfile ? { profile } : {}) });
    } catch (cause) {
      switch (getApiErrorCode(cause)) {
        // Not a failure: the store has raised `needsProfile`, which reveals the
        // fields below, and the code the farmer just typed is still good.
        case 'PROFILE_REQUIRED':
          break;
        // Both of these finish the code. The field closes and the only way on
        // is a new one, so they are held apart from the message that a retry
        // clears -- there is no retry left to clear it.
        case 'OTP_ATTEMPTS_EXCEEDED':
          setFinished('locked');
          break;
        case 'OTP_EXPIRED':
          setFinished('expired');
          break;
        // Including `OTP_INVALID`, whose message carries the attempts the
        // server says are left.
        default:
          setMessage(getAuthErrorMessage(cause, t));
      }
    } finally {
      setStatus('idle');
    }
  };

  const handleResend = async (): Promise<void> => {
    setMessage(null);
    setStatus('resending');
    try {
      // Clears the boxes for the new code, since what is in them belongs to
      // the dead one, and resets the expiry the countdown runs down.
      await requestOtp(phone);
      setFinished(null);
    } catch (cause) {
      // The expiry stands -- being refused a new code does not revive the old
      // one -- so only the message changes. A dated rate limit is already
      // answered beside the button that was refused, and counting down; saying
      // it twice, once in a form that goes stale, would be worse than not at
      // all.
      setMessage(
        useAuthStore.getState().otpRetryAt === null ? getAuthErrorMessage(cause, t) : null,
      );
    } finally {
      setStatus('idle');
    }
  };

  const useAnotherNumber = (): void => {
    resetLoginFlow();
    navigate('/login/phone', { replace: true, state: redirectState });
  };

  return (
    <>
      <div className="flex flex-col gap-1 text-center lg:text-left">
        <h2 className="text-xl font-semibold lg:text-2xl">
          {t('auth.verify.title', 'Enter your code')}
        </h2>
        <p className="text-sm text-muted">
          {t('auth.verify.sentTo', { defaultValue: 'We sent a code to {{phone}}.', phone })}
        </p>
      </div>

      {devCode !== undefined && (
        <p className="rounded-lg border border-dashed border-muted-300 px-3 py-2 text-sm">
          {t('auth.verify.devCode', { defaultValue: 'Dev mode code: {{code}}', code: devCode })}
        </p>
      )}

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        // The boxes decide what a code may contain and the submit button waits
        // until all six are filled, so the browser's own validation has nothing
        // to add here -- and it would speak the browser's language, not the
        // farmer's.
        noValidate
        className="flex flex-col gap-4"
      >
        <OtpInput
          // Remounted when a new code is sent, which drops whatever the browser
          // was holding in the boxes and puts the caret back in the first one.
          key={otpChallenge.expiresAt}
          length={OTP_CODE_LENGTH}
          value={code}
          onChange={(next) => {
            setVerifyDraft({ code: toCodeDigits(next) });
            // The message is about the code that was sent, not the one being
            // typed now. A finished code has no such retry, and its notice is
            // not held here, so it stays put.
            setMessage(null);
          }}
          label={t('auth.verify.label', 'Verification code')}
          digitLabel={(index, total) =>
            t('auth.verify.digit', {
              defaultValue: 'Digit {{index}} of {{total}}',
              index,
              total,
            })
          }
          disabled={isBusy || ending !== null}
          autoFocus
          {...(notice === null ? {} : { error: notice })}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Deliberately not a live region. A clock that announced itself every
              second would bury the screen; what matters -- that the code has
              run out -- arrives as the alert under the boxes instead. */}
          <p
            id={countdownId}
            className={cx('text-sm', retryNotice === null ? 'text-muted' : 'text-danger-700')}
          >
            {retryNotice ??
              (secondsLeft > 0
                ? t('auth.verify.expiresIn', {
                    defaultValue: 'Code expires in {{time}}',
                    time: formatCountdown(secondsLeft),
                  })
                : t('auth.verify.expiredHint', 'Your code has run out.'))}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void handleResend();
            }}
            disabled={!canResend}
            loading={status === 'resending'}
            // The countdown is the reason this button is disabled, so it is
            // read out with it rather than left as an unexplained dead control.
            aria-describedby={countdownId}
          >
            {t('auth.verify.resend', 'Send a new code')}
          </Button>
        </div>

        {needsProfile && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm text-muted">
              {t(
                'auth.profile.legend',
                'No account uses this number yet. Add your details to create one.',
              )}
            </legend>
            <Input
              label={t('auth.profile.name', 'Name')}
              value={name}
              onChange={(event) => {
                setVerifyDraft({ name: event.target.value });
              }}
              autoComplete="name"
              required
            />
            <Input
              label={t('auth.profile.district', 'District')}
              value={district}
              onChange={(event) => {
                setVerifyDraft({ district: event.target.value });
              }}
              required
            />
          </fieldset>
        )}

        <Button type="submit" disabled={!canSubmit} loading={status === 'verifying'}>
          {needsProfile
            ? t('auth.profile.submit', 'Create account')
            : t('auth.verify.submit', 'Sign in')}
        </Button>
        <Button variant="secondary" onClick={useAnotherNumber} disabled={isBusy}>
          {t('auth.verify.changeNumber', 'Use a different number')}
        </Button>
      </form>
    </>
  );
}
