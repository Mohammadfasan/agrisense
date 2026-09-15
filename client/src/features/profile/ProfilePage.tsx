import { zodResolver } from '@hookform/resolvers/zod';
import { LocateFixed, Pencil } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useController, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import type {
  CropCode,
  District,
  FarmerProfileRecord,
  FarmerProfileUpdateInput,
} from '@agrisense/shared';

import { LanguageSwitcher, useAuthStore } from '@/features/auth';
import {
  CROP_OPTIONS,
  onboardingSchema,
  useGeolocation,
  type OnboardingOutput,
  type OnboardingValues,
} from '@/features/onboarding';
import { Button, Card, ChoiceGroup, Input, Spinner } from '@/shared/components';

import { useProfileFields } from './fields';

/**
 * The profile — read-only until the farmer asks to change it.
 *
 * Read-only by default because this screen is mostly visited to check
 * something rather than to change it, and a form full of live inputs invites
 * an accidental edit on a phone. The edit form is the wizard's schema over the
 * wizard's fields, so both screens accept exactly the same values.
 *
 * Saves go out as a `PATCH` carrying only what changed — see
 * {@link buildPatch}.
 */
export function ProfilePage(): ReactElement {
  const { t } = useTranslation();
  const profile = useAuthStore((state) => state.profile);
  const profileStatus = useAuthStore((state) => state.profileStatus);
  const [isEditing, setIsEditing] = useState(false);

  // `RequireProfile` guarantees a profile before this renders, so these are
  // the states it cannot reach rather than ones expected in normal use.
  if (profileStatus === 'none') {
    return <Navigate to="/onboarding" replace />;
  }
  if (!profile) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('profile.title', 'Profile')}</h2>
        {!isEditing && (
          <Button
            variant="secondary"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
            {t('profile.edit', 'Edit')}
          </Button>
        )}
      </div>

      {isEditing ? (
        <EditForm
          profile={profile}
          onDone={() => {
            setIsEditing(false);
          }}
        />
      ) : (
        <ReadOnlyView profile={profile} />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ReadOnlyView({ profile }: { profile: FarmerProfileRecord }): ReactElement {
  const { t } = useTranslation();
  const { fields, cropName, districtName } = useProfileFields();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [longitude, latitude] = profile.location.coordinates;

  return (
    <>
      <Card>
        <dl className="flex flex-col divide-y divide-muted-200">
          <Row label={fields.fullName.label} value={profile.fullName} />
          {user && <Row label={t('profile.field.phone', 'Mobile number')} value={user.phone} />}
          <Row label={fields.district.label} value={districtName(profile.district)} />
          <Row label={fields.gnDivision.label} value={profile.gnDivision} />
          <Row
            label={fields.landSizeAcres.label}
            value={t('profile.value.acres', {
              defaultValue: '{{count}} acres',
              count: profile.landSizeAcres,
            })}
          />
          <Row
            label={fields.primaryCrops.label}
            value={profile.primaryCrops.map(cropName).join(', ')}
          />
          <Row
            label={t('profile.field.location', 'Location')}
            value={`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
          />
        </dl>
      </Card>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-900">{t('profile.language', 'Language')}</p>
        {/* The language screen promises this can be changed here later. */}
        <LanguageSwitcher />
      </div>

      <button type="button" className="btn-ghost self-start" onClick={logout}>
        {t('auth.signOut', 'Sign out')}
      </button>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-base font-medium text-gray-900">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EditForm({
  profile,
  onDone,
}: {
  profile: FarmerProfileRecord;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { fields, districtOptions } = useProfileFields();
  const patchProfile = useAuthStore((state) => state.patchProfile);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [longitude, latitude] = profile.location.coordinates;

  const form = useForm<OnboardingValues, unknown, OnboardingOutput>({
    resolver: zodResolver(onboardingSchema),
    mode: 'onTouched',
    // The saved profile is the baseline, which is what makes `dirtyFields`
    // mean "differs from what the server holds".
    defaultValues: {
      fullName: profile.fullName,
      district: profile.district,
      gnDivision: profile.gnDivision,
      landSizeAcres: profile.landSizeAcres,
      primaryCrops: [...profile.primaryCrops],
      latitude,
      longitude,
    },
  });

  const { errors, dirtyFields, isSubmitting, isDirty } = form.formState;
  const district = useController({ control: form.control, name: 'district' });
  const crops = useController({ control: form.control, name: 'primaryCrops' });

  const { status, request } = useGeolocation((next) => {
    const options = { shouldValidate: true, shouldDirty: true } as const;
    form.setValue('latitude', next.latitude, options);
    form.setValue('longitude', next.longitude, options);
  });

  const cropOptions = CROP_OPTIONS.map(({ code, icon, fallback }) => ({
    value: code,
    label: t(`crop.${code}`, { defaultValue: fallback }),
    icon,
  }));

  const onSubmit = form.handleSubmit(async (values) => {
    setSaveError(null);
    const patch = buildPatch(values, dirtyFields);

    // Nothing changed. Sending an empty PATCH would be a round trip whose
    // only effect is bumping `updatedAt`.
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }

    try {
      await patchProfile(patch);
      onDone();
    } catch {
      setSaveError(t('profile.saveFailed', 'Could not save your changes. Check your connection.'));
    }
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <Input
        label={fields.fullName.label}
        autoComplete="name"
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

      <Input
        label={fields.landSizeAcres.label}
        type="number"
        inputMode="decimal"
        step="0.1"
        {...form.register('landSizeAcres', {
          setValueAs: (value: unknown) => (value === '' || value === null ? undefined : Number(value)),
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

      <div className="flex flex-col gap-3">
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
        <Button
          variant="secondary"
          className="self-start"
          loading={status === 'locating'}
          onClick={request}
        >
          <LocateFixed className="h-4 w-4" aria-hidden />
          {t('onboarding.location.useGps', 'Use my GPS')}
        </Button>
      </div>

      {saveError !== null && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {saveError}
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onDone}>
          {t('profile.cancel', 'Cancel')}
        </Button>
        <Button type="submit" className="flex-1" loading={isSubmitting} disabled={!isDirty}>
          {t('profile.save', 'Save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The changed fields only, as the API's `PATCH` body.
 *
 * Driven by react-hook-form's `dirtyFields`, which compares against the
 * profile the form was seeded with. Sending the whole form instead would work,
 * but it would also overwrite any field another device had changed in the
 * meantime with the value this screen happened to load.
 *
 * `latitude` and `longitude` are two fields here and one field on the server,
 * so either being dirty sends the whole point — half a coordinate pair is not
 * a location.
 */
function buildPatch(
  values: OnboardingOutput,
  dirtyFields: Partial<Readonly<Record<keyof OnboardingValues, unknown>>>,
): FarmerProfileUpdateInput {
  const patch: FarmerProfileUpdateInput = {};

  if (dirtyFields.fullName) {
    patch.fullName = values.fullName;
  }
  if (dirtyFields.district) {
    patch.district = values.district;
  }
  if (dirtyFields.gnDivision) {
    patch.gnDivision = values.gnDivision;
  }
  if (dirtyFields.landSizeAcres) {
    patch.landSizeAcres = values.landSizeAcres;
  }
  // An array: react-hook-form marks this either `true` or as a list of
  // per-index flags, so truthiness is the only reliable reading.
  if (dirtyFields.primaryCrops) {
    patch.primaryCrops = values.primaryCrops;
  }
  if (dirtyFields.latitude || dirtyFields.longitude) {
    patch.location = { type: 'Point', coordinates: [values.longitude, values.latitude] };
  }

  return patch;
}
