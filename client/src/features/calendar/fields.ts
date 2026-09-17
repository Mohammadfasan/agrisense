import type { ActivityType } from '@agrisense/shared';
import { useTranslation } from 'react-i18next';

import type { ChoiceOption } from '@/shared/components';

import { ACTIVITY_META, ACTIVITY_OPTIONS } from './activity';

/**
 * The labels, hints and error messages for the task fields, in the farmer's
 * language.
 *
 * The same arrangement as `plots/fields.ts` and `profile/fields.ts`, for the
 * same two reasons: Zod's own messages are English strings written for a
 * developer, and one message per field beats one per failure for someone
 * reading with difficulty.
 */

export type TaskFieldName = 'type' | 'title' | 'dueDate' | 'notes';

export interface TaskFieldText {
  label: string;
  hint?: string;
  /** Shown whenever the field is invalid, whatever the reason. */
  invalid: string;
}

export interface TaskFieldset {
  fields: Record<TaskFieldName, TaskFieldText>;
  /** The activity types, localised, with the picker's icons. */
  activityOptions: ChoiceOption<ActivityType>[];
  /** Localised activity name, for a row rather than the picker. */
  activityName: (type: ActivityType) => string;
}

export function useTaskFields(): TaskFieldset {
  const { t } = useTranslation();

  const activityName = (type: ActivityType): string =>
    t(`calendar.activity.${type}`, { defaultValue: ACTIVITY_META[type].fallback });

  return {
    activityName,
    activityOptions: ACTIVITY_OPTIONS.map(({ type, icon }) => ({
      value: type,
      label: activityName(type),
      icon,
    })),
    fields: {
      type: {
        label: t('calendar.field.type', 'What kind of work?'),
        invalid: t('calendar.invalid.type', 'Choose the kind of work.'),
      },
      title: {
        label: t('calendar.field.title', 'What needs doing?'),
        hint: t('calendar.hint.title', 'A few words you will recognise, like "Spray for thrips".'),
        invalid: t('calendar.invalid.title', 'Enter what needs doing, up to 100 letters.'),
      },
      dueDate: {
        label: t('calendar.field.dueDate', 'Which day?'),
        invalid: t('calendar.invalid.dueDate', 'Choose the day this is due.'),
      },
      notes: {
        label: t('calendar.field.notes', 'Notes'),
        hint: t('calendar.hint.notes', 'Anything worth remembering — a quantity, a product name.'),
        invalid: t('calendar.invalid.notes', 'Notes can be up to 500 letters.'),
      },
    },
  };
}
