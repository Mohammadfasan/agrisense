import { DISTRICTS, type CropCode, type District } from '@agrisense/shared';
import { useTranslation } from 'react-i18next';

import type { ChoiceOption } from '@/shared/components';

/**
 * The labels, hints and error messages for the profile fields, in the
 * farmer's language.
 *
 * Shared by the onboarding wizard and the profile editor, which collect the
 * same fields under the same rules and should not word them differently.
 *
 * Deliberately **not** Zod's own messages. `farmerProfileSchema` lives in
 * `@agrisense/shared` and is validated on both sides, so its messages are
 * English strings like "String must contain at least 2 character(s)" -- which
 * is the wrong language for two thirds of this audience and the wrong register
 * for all of it. One message per field rather than one per failure, too: for
 * someone reading with difficulty, "Enter your full name, at least 2 letters"
 * is more use than knowing whether they tripped the minimum or the maximum.
 */

export type ProfileFieldName =
  | 'fullName'
  | 'district'
  | 'gnDivision'
  | 'landSizeAcres'
  | 'primaryCrops'
  | 'latitude'
  | 'longitude';

export interface ProfileFieldText {
  label: string;
  hint?: string;
  /** Shown whenever the field is invalid, whatever the reason. */
  invalid: string;
}

export interface ProfileFieldset {
  fields: Record<ProfileFieldName, ProfileFieldText>;
  /** District options in the shared presentation order, names localised. */
  districtOptions: ChoiceOption<District>[];
  /** Localised crop name, for a summary line rather than the picker. */
  cropName: (code: CropCode) => string;
  districtName: (district: District) => string;
}

export function useProfileFields(): ProfileFieldset {
  const { t } = useTranslation();

  // Administrative names are stored untranslated (`docs/schema.md` §18), so
  // the display name is looked up here. The English fallback is the stored
  // value itself, which is already the canonical spelling.
  const districtName = (district: District): string =>
    t(`district.${district}`, { defaultValue: district });

  const cropName = (code: CropCode): string =>
    t(`crop.${code}`, { defaultValue: CROP_LABEL[code] });

  return {
    districtName,
    cropName,
    districtOptions: DISTRICTS.map((district) => ({
      value: district,
      label: districtName(district),
    })),
    fields: {
      fullName: {
        label: t('profile.field.fullName', 'Your name'),
        invalid: t('profile.invalid.fullName', 'Enter your full name, at least 2 letters.'),
      },
      district: {
        label: t('profile.field.district', 'District'),
        invalid: t('profile.invalid.district', 'Choose your district.'),
      },
      gnDivision: {
        label: t('profile.field.gnDivision', 'Grama Niladhari division'),
        hint: t('profile.hint.gnDivision', 'The GN division your land is in.'),
        invalid: t('profile.invalid.gnDivision', 'Enter your GN division.'),
      },
      landSizeAcres: {
        label: t('profile.field.landSizeAcres', 'Land size (acres)'),
        invalid: t('profile.invalid.landSizeAcres', 'Enter the land size in acres, from 0.1 to 1000.'),
      },
      primaryCrops: {
        label: t('profile.field.primaryCrops', 'What do you grow?'),
        hint: t('profile.hint.primaryCrops', 'Choose one or more.'),
        invalid: t('profile.invalid.primaryCrops', 'Choose at least one crop.'),
      },
      latitude: {
        label: t('profile.field.latitude', 'Latitude'),
        invalid: t('profile.invalid.latitude', 'Enter a latitude between -90 and 90.'),
      },
      longitude: {
        label: t('profile.field.longitude', 'Longitude'),
        invalid: t('profile.invalid.longitude', 'Enter a longitude between -180 and 180.'),
      },
    },
  };
}

/** English fallbacks, keyed so a crop added upstream fails the build here. */
const CROP_LABEL: Record<CropCode, string> = {
  PADDY: 'Paddy',
  TOMATO: 'Tomato',
  CHILLI: 'Chilli',
  ONION: 'Onion',
  BRINJAL: 'Brinjal',
};
