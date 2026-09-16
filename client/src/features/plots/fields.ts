import type { CropCode } from '@agrisense/shared';
import { useTranslation } from 'react-i18next';

import { CROP_META, CROP_OPTIONS } from '@/features/onboarding';
import type { ChoiceOption } from '@/shared/components';

/**
 * The labels, hints and error messages for the plot fields, in the farmer's
 * language.
 *
 * The same arrangement as `profile/fields.ts`, and for the same two reasons:
 * Zod's own messages are English strings written for a developer, and one
 * message per field beats one per failure for someone reading with difficulty
 * — "from 0.01 to 1000 acres" is more use than knowing which bound was hit.
 */

export type PlotFieldName =
  'name' | 'crop' | 'areaAcres' | 'plantedAt' | 'notes' | 'latitude' | 'longitude';

export interface PlotFieldText {
  label: string;
  hint?: string;
  /** Shown whenever the field is invalid, whatever the reason. */
  invalid: string;
}

export interface PlotFieldset {
  fields: Record<PlotFieldName, PlotFieldText>;
  /** The crops, localised, with the picker's icons. */
  cropOptions: ChoiceOption<CropCode>[];
  /** Localised crop name, for a card line rather than the picker. */
  cropName: (code: CropCode) => string;
}

export function usePlotFields(): PlotFieldset {
  const { t } = useTranslation();

  const cropName = (code: CropCode): string =>
    t(`crop.${code}`, { defaultValue: CROP_META[code].fallback });

  return {
    cropName,
    cropOptions: CROP_OPTIONS.map(({ code, icon }) => ({
      value: code,
      label: cropName(code),
      icon,
    })),
    fields: {
      name: {
        label: t('plot.field.name', 'Plot name'),
        hint: t('plot.hint.name', 'A name you will know it by, like "Upper field".'),
        invalid: t('plot.invalid.name', 'Enter a name for this plot, up to 60 letters.'),
      },
      crop: {
        label: t('plot.field.crop', 'What is growing here?'),
        invalid: t('plot.invalid.crop', 'Choose the crop growing here.'),
      },
      areaAcres: {
        label: t('plot.field.areaAcres', 'Size (acres)'),
        invalid: t('plot.invalid.areaAcres', 'Enter the size in acres, from 0.01 to 1000.'),
      },
      plantedAt: {
        label: t('plot.field.plantedAt', 'Planted on'),
        hint: t('plot.hint.plantedAt', 'Leave this empty if you have not planted yet.'),
        invalid: t('plot.invalid.plantedAt', 'Enter the date it was planted.'),
      },
      notes: {
        label: t('plot.field.notes', 'Notes'),
        hint: t('plot.hint.notes', 'Anything worth remembering about this plot.'),
        invalid: t('plot.invalid.notes', 'Notes can be up to 500 letters.'),
      },
      // The same two bounds the profile screen states, deliberately worded the
      // same way: it is the same question about the same kind of place.
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
