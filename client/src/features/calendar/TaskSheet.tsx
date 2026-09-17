import type { ActivityType, CalendarTaskRecord } from '@agrisense/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useController, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  BottomSheet,
  Button,
  ChoiceGroup,
  ConfirmDialog,
  Input,
  Textarea,
} from '@/shared/components';
import { todayIso } from '@/shared/i18n/dates';

import { taskTitle } from './activity';
import { useCalendarStore } from './calendarStore';
import { deleteErrorMessage, saveErrorMessage } from './errors';
import { useTaskFields } from './fields';
import {
  taskFormSchema,
  toFormValues,
  toTaskInput,
  type TaskFormOutput,
  type TaskFormValues,
} from './task';

export interface TaskSheetProps {
  open: boolean;
  /** The plot the task belongs to. From the route, never asked for. */
  plotId: string;
  /** The task being edited, or `null` to add one. */
  task: CalendarTaskRecord | null;
  /** Pre-fills the day when adding — the bucket the farmer tapped "add" in. */
  defaultDueDate?: string;
  onClose: () => void;
}

/**
 * Add or edit one task, in a sheet over the calendar.
 *
 * One component for both, because the two collect exactly the same four fields
 * under exactly the same rules; what differs is the id the save goes to and
 * whether there is anything to delete. The same split `PlotForm` makes, in a
 * third of the space, because there is no GPS and no coordinate fallback here.
 *
 * Both ends save with `PUT`. That is the create — the id is minted on the
 * client (ADR 001) — and for an edit it is the endpoint offline sync will
 * replay into, so the sheet exercises the path a queued write will take.
 */
export function TaskSheet({
  open,
  plotId,
  task,
  defaultDueDate,
  onClose,
}: TaskSheetProps): ReactElement {
  const { t } = useTranslation();
  const { fields, activityOptions } = useTaskFields();
  const createTask = useCalendarStore((state) => state.createTask);
  const saveTask = useCalendarStore((state) => state.saveTask);
  const deleteTask = useCalendarStore((state) => state.deleteTask);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm<TaskFormValues, unknown, TaskFormOutput>({
    resolver: zodResolver(taskFormSchema),
    // `onTouched`, so a farmer is not told a field is wrong while they are
    // still on their first pass through it.
    mode: 'onTouched',
    defaultValues:
      task === null
        ? { type: 'irrigation', title: '', dueDate: defaultDueDate ?? todayIso(), notes: '' }
        : toFormValues(task, t),
  });

  const { errors, isSubmitting } = form.formState;
  const type = useController({ control: form.control, name: 'type' });

  const onSubmit = form.handleSubmit(async (values) => {
    setActionError(null);
    try {
      if (task === null) {
        await createTask(toTaskInput(values, plotId));
      } else {
        // The saved reminder is carried through: `PUT` replaces the whole
        // task, and this form has no control that could set one back.
        await saveTask(task._id, toTaskInput(values, plotId, task.reminderAt));
      }
      onClose();
    } catch (cause) {
      setActionError(saveErrorMessage(cause, t));
    }
  });

  const onDelete = async (): Promise<void> => {
    if (task === null) {
      return;
    }
    setActionError(null);
    setIsDeleting(true);
    try {
      await deleteTask(task._id);
      onClose();
    } catch (cause) {
      setActionError(deleteErrorMessage(cause, t));
      setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      busy={isSubmitting || isDeleting}
      title={
        task === null
          ? t('calendar.add.title', 'Add a task')
          : t('calendar.edit.title', 'Edit task')
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <ChoiceGroup<ActivityType>
          legend={fields.type.label}
          options={activityOptions}
          // Two columns and not three: "பூச்சி கட்டுப்பாடு" and
          // "පළිබෝධ පාලනය" do not fit a 110px cell on a 360px screen, and a
          // wrapped two-line label in a three-up grid is what makes a picker
          // look broken in one language and fine in another.
          columns={2}
          value={type.field.value}
          onChange={type.field.onChange}
          {...(errors.type ? { error: fields.type.invalid } : {})}
        />

        <Input
          label={fields.title.label}
          {...(fields.title.hint === undefined ? {} : { hint: fields.title.hint })}
          maxLength={100}
          {...form.register('title')}
          {...(errors.title ? { error: fields.title.invalid } : {})}
        />

        {/* A native date input: it opens the platform's own picker, which is
            already in the farmer's language and already understands their
            calendar. Its value is `YYYY-MM-DD`, which is exactly what the API
            takes — no conversion, and so no day to lose. */}
        <Input
          label={fields.dueDate.label}
          type="date"
          {...form.register('dueDate')}
          {...(errors.dueDate ? { error: fields.dueDate.invalid } : {})}
        />

        <Textarea
          label={fields.notes.label}
          {...(fields.notes.hint === undefined ? {} : { hint: fields.notes.hint })}
          maxLength={500}
          rows={3}
          {...form.register('notes')}
          {...(errors.notes ? { error: fields.notes.invalid } : {})}
        />

        {task !== null && (
          <>
            <button
              type="button"
              className="btn-ghost w-full text-danger-700 hover:bg-danger-50"
              onClick={() => {
                setIsConfirmingDelete(true);
              }}
            >
              <Trash2 className="h-5 w-5" aria-hidden />
              {t('calendar.delete', 'Delete task')}
            </button>

            <ConfirmDialog
              open={isConfirmingDelete}
              title={t('calendar.confirmDelete.title', 'Delete this task?')}
              description={t('calendar.confirmDelete.description', {
                defaultValue: '"{{title}}" will be removed from this plot\'s calendar.',
                title: taskTitle(task, t),
              })}
              confirmLabel={t('calendar.confirmDelete.confirm', 'Delete')}
              cancelLabel={t('calendar.confirmDelete.cancel', 'Keep task')}
              busy={isDeleting}
              onConfirm={() => {
                void onDelete();
              }}
              onCancel={() => {
                setIsConfirmingDelete(false);
              }}
            />
          </>
        )}

        {actionError !== null && (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {actionError}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t('calendar.cancel', 'Cancel')}
          </Button>
          <Button type="submit" className="flex-1 min-h-touch-md" loading={isSubmitting}>
            {t('calendar.save', 'Save task')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
