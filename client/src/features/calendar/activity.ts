import { ACTIVITY_TYPES, type ActivityType, type CalendarTaskRecord } from '@agrisense/shared';
import type { TFunction } from 'i18next';
import { Beaker, Bug, Droplets, Scissors, Sprout, Wheat, type LucideIcon } from 'lucide-react';

/**
 * An icon and an English fallback per activity type.
 *
 * The icons stand beside the word, never instead of it — the same rule the
 * home screen follows. A farmer reading with difficulty gets two chances at
 * the meaning, and neither is a pictogram they have to have been taught.
 *
 * Keyed by `ActivityType`, so adding a type to the shared list fails the build
 * here until it has an icon.
 */
export const ACTIVITY_META: Readonly<Record<ActivityType, { icon: LucideIcon; fallback: string }>> =
  {
    sowing: { icon: Sprout, fallback: 'Sowing' },
    fertilising: { icon: Beaker, fallback: 'Fertilising' },
    irrigation: { icon: Droplets, fallback: 'Watering' },
    pest_control: { icon: Bug, fallback: 'Pest control' },
    weeding: { icon: Scissors, fallback: 'Weeding' },
    harvest: { icon: Wheat, fallback: 'Harvest' },
  };

/** The types in the order they are offered in the form. */
export const ACTIVITY_OPTIONS = ACTIVITY_TYPES.map((type) => ({ type, ...ACTIVITY_META[type] }));

/**
 * A task's title, in the farmer's language.
 *
 * A template task stores an **i18n key** — the server refuses to pick one of
 * three languages to write agronomy in, so `calendar.task.paddy.sowing.title`
 * is what arrives and the client resolves it. A manual task stores whatever
 * the farmer typed and is printed as-is: running it through `t()` would be
 * harmless but meaningless, and a title containing a dot would be read as a
 * key path.
 *
 * The key is its own fallback, so a template activity added to the agronomy
 * file before its translations land renders the key rather than nothing at
 * all — visibly wrong, which is the right kind of wrong.
 */
export function taskTitle(task: CalendarTaskRecord, t: TFunction): string {
  return task.source === 'template' ? t(task.title, { defaultValue: task.title }) : task.title;
}

/** The task's note, on the same terms as {@link taskTitle}. `''` when there is none. */
export function taskNotes(task: CalendarTaskRecord, t: TFunction): string {
  const notes = task.notes ?? '';

  if (notes === '') {
    return '';
  }
  return task.source === 'template' ? t(notes, { defaultValue: notes }) : notes;
}
