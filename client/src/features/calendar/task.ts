import {
  calendarTaskCreateSchema,
  type CalendarTaskInput,
  type CalendarTaskRecord,
} from '@agrisense/shared';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { taskNotes, taskTitle } from './activity';

/**
 * The task form's contract.
 *
 * Derived from the shared `calendarTaskCreateSchema` rather than written out
 * again, so the title length, the activity list and — the one that matters —
 * the `YYYY-MM-DD` rule are the rules the API enforces, with no second copy to
 * drift. The same reasoning as `plots/plot.ts`.
 *
 * Two fields are dropped:
 *
 * - `plotId` comes from the route. The form is always opened from one plot's
 *   calendar, and a field asking which plot this is work on would be a
 *   question the screen has already answered.
 * - `reminderAt` is reserved for Week 9 and has no control to set it. An edit
 *   carries the saved value through {@link toTaskInput} rather than clearing
 *   it, because `PUT` replaces the whole task.
 */
export const taskFormSchema = calendarTaskCreateSchema
  .omit({ plotId: true, reminderAt: true, notes: true })
  .extend({
    // A textarea holds `''` when empty, not `undefined`. Emptied notes should
    // clear the field rather than save a blank string over it.
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value === '' ? undefined : value)),
  });

/** What the fields hold. */
export type TaskFormValues = z.input<typeof taskFormSchema>;
/** What they mean, once parsed. */
export type TaskFormOutput = z.output<typeof taskFormSchema>;

/**
 * Turns the form values into the body `PUT /calendar/:id` takes.
 *
 * `reminderAt` is passed back in rather than left out, and that is not a
 * detail: `PUT` replaces the whole resource, so an omitted optional field is
 * cleared. This form cannot set a reminder, so a task that arrived with one
 * would silently lose it the first time its title was corrected — the same
 * trap `toPlotInput` avoids with `boundary`.
 */
export function toTaskInput(
  values: TaskFormOutput,
  plotId: string,
  reminderAt?: string | null,
): CalendarTaskInput {
  const { notes, ...rest } = values;

  return {
    ...rest,
    plotId,
    // Spread rather than assigned: under `exactOptionalPropertyTypes` a key
    // that is present and `undefined` is not the same as an absent one, and
    // only the absent one means "no value" to the API.
    ...(notes === undefined ? {} : { notes }),
    ...(reminderAt === undefined || reminderAt === null ? {} : { reminderAt }),
  };
}

/**
 * Seeds the form from a saved task, for the edit sheet.
 *
 * A template task's title and notes are **translated on the way in**. They are
 * stored as i18n keys, and a farmer opening the sheet to move a date must not
 * be shown `calendar.task.paddy.sowing.title` in the field they are editing.
 * Saving then stores the words they saw, which is what a manual task is —
 * the server keeps `source` as it was, so the task stays part of the
 * generated calendar and a regeneration will still replace it.
 */
export function toFormValues(task: CalendarTaskRecord, t: TFunction): TaskFormValues {
  return {
    type: task.type,
    title: taskTitle(task, t),
    dueDate: task.dueDate,
    notes: taskNotes(task, t),
  };
}
