import type { CropCode, District } from '@agrisense/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, ChevronLeft, ChevronRight, LocateFixed } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth';
import { useProfileFields } from '@/features/profile';
import { Button, ChoiceGroup, Input } from '@/shared/components';
import { cx } from '@/shared/utils/cx';

import { CROP_OPTIONS } from './crops';
import {
  clearDraft,
  onboardingSchema,
  readDraft,
  STEP_COUNT,
  STEP_FIELDS,
  toProfileInput,
  writeDraft,
  type OnboardingOutput,
  type OnboardingValues,
} from './onboarding';
import { useGeolocation } from './useGeolocation';

type Form = UseFormReturn<OnboardingValues, unknown, OnboardingOutput>;

/**
 * The profile wizard — three steps, one question group each.
 *
 * One `useForm` across all three rather than a form per step: the values have
 * to survive stepping backwards, and the schema that validates them is defined
 * over the whole profile. Each step validates only its own fields, through
 * `trigger`, so moving on is blocked by the answers on screen and never by a
 * question that has not been asked yet.
 *
 * Progress is written to sessionStorage on every change, so a refresh — or the
 * browser reclaiming the tab, which on a low-end phone happens while the
 * farmer is out looking at the field for its GN division — resumes where it
 * left off.
 */
export function OnboardingPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profileStatus = useAuthStore((state) => state.profileStatus);
  const saveProfile = useAuthStore((state) => state.saveProfile);

  // Read once, on mount. Re-reading on render would fight the form for
  // ownership of the values.
  const [draft] = useState(readDraft);
  const [step, setStep] = useState(draft.step);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<OnboardingValues, unknown, OnboardingOutput>({
    resolver: zodResolver(onboardingSchema),
    // `onTouched`, so a farmer is not told a field is wrong while they are
    // still on their first pass through it.
    mode: 'onTouched',
    defaultValues: { primaryCrops: [], ...draft.values },
  });

  const stepRef = useRef(step);
  stepRef.current = step;

  // Persist on every value change. Subscribing rather than reading `watch()`
  // in render: the latter returns a new object each time and would make the
  // effect below fire on renders where nothing had actually changed.
  useEffect(() => {
    const subscription = form.watch((values) => {
      writeDraft({ step: stepRef.current, values });
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [form]);

  useEffect(() => {
    writeDraft({ step, values: form.getValues() });
  }, [step, form]);

  // A farmer who already has a profile has no business here; the profile
  // screen is where they edit it.
  if (profileStatus === 'complete') {
    return <Navigate to="/" replace />;
  }

  const isLast = step === STEP_COUNT - 1;

  const goNext = async (): Promise<void> => {
    if (await form.trigger(STEP_FIELDS[step])) {
      setStep((current) => Math.min(current + 1, STEP_COUNT - 1));
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await saveProfile(toProfileInput(values));
      // Only after the server has it. Clearing on submit would lose the
      // answers if the save failed.
      clearDraft();
      navigate('/', { replace: true });
    } catch {
      setSubmitError(
        t('onboarding.saveFailed', 'Could not save your details. Check your connection.'),
      );
    }
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-4 sm:p-6">
      <StepHeader step={step} />

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-1 flex-col gap-6"
      >
        <div className="flex flex-1 flex-col gap-5">
          {step === 0 && <IdentityStep form={form} />}
          {step === 1 && <LandStep form={form} />}
          {step === 2 && <LocationStep form={form} />}
        </div>

        {submitError !== null && (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {submitError}
          </p>
        )}

        {/* Sticky, so the way forward is reachable with a thumb on a long
            step without scrolling past the last question. */}
        <div className="sticky bottom-0 flex gap-3 bg-muted-50/95 py-3">
          {step > 0 && (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setStep((current) => Math.max(current - 1, 0));
              }}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
              {t('onboarding.back', 'Back')}
            </Button>
          )}

          {isLast ? (
            <Button type="submit" className="flex-1" loading={form.formState.isSubmitting}>
              <Check className="h-5 w-5" aria-hidden />
              {t('onboarding.finish', 'Finish')}
            </Button>
          ) : (
            <Button
              className="flex-1"
              onClick={() => {
                void goNext();
              }}
            >
              {t('onboarding.next', 'Next')}
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StepHeader({ step }: { step: number }): ReactElement {
  const { t } = useTranslation();

  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold lg:text-2xl">
        {t('onboarding.title', 'Tell us about your farm')}
      </h1>

      {/* The bar is decorative; the sentence beside it is what gets read. */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <span
              key={index}
              className={cx(
                'h-2 flex-1 rounded-full',
                index <= step ? 'bg-primary' : 'bg-muted-200',
              )}
            />
          ))}
        </div>
        <p className="text-sm font-medium text-muted-700">
          {t('onboarding.progress', {
            defaultValue: 'Step {{current}} of {{total}}',
            current: step + 1,
            total: STEP_COUNT,
          })}
        </p>
      </div>
    </header>
  );
}

function IdentityStep({ form }: { form: Form }): ReactElement {
  const { fields, districtOptions } = useProfileFields();
  const { errors } = form.formState;
  const district = useController({ control: form.control, name: 'district' });

  return (
    <>
      <Input
        label={fields.fullName.label}
        autoComplete="name"
        autoFocus
        {...form.register('fullName')}
        {...(errors.fullName ? { error: fields.fullName.invalid } : {})}
      />

      <ChoiceGroup<District>
        legend={fields.district.label}
        options={districtOptions}
        value={district.field.value}
        onChange={district.field.onChange}
        {...(errors.district ? { error: fields.district.invalid } : {})}
      />

      <Input
        label={fields.gnDivision.label}
        {...(fields.gnDivision.hint === undefined ? {} : { hint: fields.gnDivision.hint })}
        {...form.register('gnDivision')}
        {...(errors.gnDivision ? { error: fields.gnDivision.invalid } : {})}
      />
    </>
  );
}

function LandStep({ form }: { form: Form }): ReactElement {
  const { t } = useTranslation();
  const { fields } = useProfileFields();
  const { errors } = form.formState;
  const crops = useController({ control: form.control, name: 'primaryCrops' });

  const cropOptions = CROP_OPTIONS.map(({ code, icon, fallback }) => ({
    value: code,
    label: t(`crop.${code}`, { defaultValue: fallback }),
    icon,
  }));

  return (
    <>
      <Input
        label={fields.landSizeAcres.label}
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0.1"
        max="1000"
        autoFocus
        {...form.register('landSizeAcres', {
          // An empty field becomes `undefined` rather than `NaN`, which reads
          // as "missing" to the schema instead of "not a number".
          setValueAs: (value: unknown) =>
            value === '' || value === null ? undefined : Number(value),
        })}
        {...(errors.landSizeAcres ? { error: fields.landSizeAcres.invalid } : {})}
      />

      <ChoiceGroup<CropCode>
        multiple
        legend={fields.primaryCrops.label}
        {...(fields.primaryCrops.hint === undefined ? {} : { hint: fields.primaryCrops.hint })}
        options={cropOptions}
        columns={3}
        value={crops.field.value}
        onChange={crops.field.onChange}
        {...(errors.primaryCrops ? { error: fields.primaryCrops.invalid } : {})}
      />
    </>
  );
}

function LocationStep({ form }: { form: Form }): ReactElement {
  const { t } = useTranslation();
  const { fields } = useProfileFields();
  const { errors } = form.formState;
  const [manual, setManual] = useState(false);

  const { status, coordinates, request } = useGeolocation((next) => {
    // `shouldDirty`, so the profile screen's dirty-field diffing sees a GPS
    // fix the same way it sees a typed value.
    const options = { shouldValidate: true, shouldDirty: true } as const;
    form.setValue('latitude', next.latitude, options);
    form.setValue('longitude', next.longitude, options);
  });

  // A refusal is final until the farmer changes it in browser settings, so the
  // fields open themselves rather than waiting for another tap. An unavailable
  // or timed-out fix is worth retrying, so that one does not.
  const showManual = manual || status === 'denied';

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-900">
          {t('onboarding.location.legend', 'Where is your land?')}
        </p>
        <p className="text-sm text-muted">
          {t(
            'onboarding.location.hint',
            'This is used to warn you about disease outbreaks near you.',
          )}
        </p>
      </div>

      <Button
        variant="secondary"
        className="min-h-touch-lg w-full"
        loading={status === 'locating'}
        onClick={request}
      >
        <LocateFixed className="h-5 w-5" aria-hidden />
        {t('onboarding.location.useGps', 'Use my GPS')}
      </Button>

      {/* `status` is announced rather than only shown: the outcome of tapping
          that button is the one thing on this step a farmer cannot see. */}
      <p role="status" className="text-sm">
        {status === 'granted' && coordinates && (
          <span className="font-medium text-primary-700">
            {t('onboarding.location.found', {
              defaultValue: 'Location found: {{lat}}, {{lng}}',
              lat: coordinates.latitude.toFixed(5),
              lng: coordinates.longitude.toFixed(5),
            })}
          </span>
        )}
        {status === 'denied' && (
          <span className="text-muted-700">
            {t(
              'onboarding.location.denied',
              'Location permission was refused. Enter the coordinates instead.',
            )}
          </span>
        )}
        {status === 'unavailable' && (
          <span className="text-muted-700">
            {t('onboarding.location.unavailable', 'Could not get your location. Try again.')}
          </span>
        )}
      </p>

      {!showManual && (
        // Not in the brief, but without it a farmer who never taps the GPS
        // button — or taps it and gets a timeout — has no way to finish.
        <button
          type="button"
          className="min-h-touch self-start text-sm font-medium text-primary-700 underline"
          onClick={() => {
            setManual(true);
          }}
        >
          {t('onboarding.location.enterManually', 'Enter coordinates by hand')}
        </button>
      )}

      {showManual && (
        <div className="flex gap-3">
          <Input
            label={fields.latitude.label}
            type="number"
            inputMode="decimal"
            step="any"
            className="flex-1"
            {...form.register('latitude', {
              setValueAs: (value: unknown) =>
                value === '' || value === null ? undefined : Number(value),
            })}
            {...(errors.latitude ? { error: fields.latitude.invalid } : {})}
          />
          <Input
            label={fields.longitude.label}
            type="number"
            inputMode="decimal"
            step="any"
            className="flex-1"
            {...form.register('longitude', {
              setValueAs: (value: unknown) =>
                value === '' || value === null ? undefined : Number(value),
            })}
            {...(errors.longitude ? { error: fields.longitude.invalid } : {})}
          />
        </div>
      )}
    </>
  );
}
