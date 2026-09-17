import type { CalendarTaskRecord } from '@agrisense/shared';
import { CalendarDays, Check, ChevronDown, ListTodo, Pencil, Plus, Undo2 } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { usePlotStore } from '@/features/plots/plotStore';
import { Button, EmptyState, Spinner } from '@/shared/components';
import { formatDayRelative, todayIso } from '@/shared/i18n/dates';
import { cx } from '@/shared/utils/cx';

import { ACTIVITY_META, taskNotes, taskTitle } from './activity';
import { useCalendarStore } from './calendarStore';
import { completeErrorMessage, listErrorMessage } from './errors';
import { useTaskFields } from './fields';
import { groupTasks, TASK_BUCKETS, type TaskBucket } from './grouping';
import { TaskSheet } from './TaskSheet';

/**
 * `/plots/:id/calendar` — one plot's crop calendar.
 *
 * Built for the same farmer as every other screen here: 360px, one hand,
 * sunlight. Which decides the shape of it.
 *
 * **It is a list of days to act on, not a month grid.** A grid on a phone puts
 * 30 cells of four characters each on a screen held at arm's length, and
 * answers "what is the date" — which the farmer knows — instead of "what do I
 * do now", which they are asking. So: overdue, today, this week, later.
 *
 * **The tick is the biggest thing on the row.** Completing a task is the only
 * action taken standing in the field with a thumb, so it gets a 48px target of
 * its own on the right, away from the body of the row, which opens the editor.
 *
 * **Done work collapses rather than disappearing.** The calendar is the record
 * of the season as well as the plan.
 */
export function CalendarPage(): ReactElement {
  const { id } = useParams<{ id: string }>();

  // The route cannot match without one; this is the type narrowing, not a
  // state the screen can reach.
  return id === undefined ? <MissingPlot /> : <PlotCalendar plotId={id} />;
}

/* -------------------------------------------------------------------------- */

function PlotCalendar({ plotId }: { plotId: string }): ReactElement {
  const { t } = useTranslation();
  const tasks = useCalendarStore((state) => state.byPlot[plotId]);
  const status = useCalendarStore((state) => state.plotStatus[plotId] ?? 'idle');
  const error = useCalendarStore((state) => state.plotError[plotId] ?? null);
  const ensureLoaded = useCalendarStore((state) => state.ensureLoadedForPlot);
  const fetchForPlot = useCalendarStore((state) => state.fetchForPlot);

  const plot = usePlotStore((state) => state.plots.find((candidate) => candidate._id === plotId));
  const fetchPlot = usePlotStore((state) => state.fetchPlot);

  const [editing, setEditing] = useState<CalendarTaskRecord | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // The day a new task is pre-filled with. Held rather than derived, so that
  // "add" from a bucket heading could seed a different day later without the
  // sheet having to know which list it was opened from.
  const [addDay, setAddDay] = useState(todayIso);

  useEffect(() => {
    void ensureLoaded(plotId);
  }, [plotId, ensureLoaded]);

  useEffect(() => {
    // Only for a link opened cold — a bookmark, a reload on this screen. The
    // usual way in is a tap on a card, which means the plot is already there.
    if (plot === undefined) {
      void fetchPlot(plotId);
    }
  }, [plotId, plot, fetchPlot]);

  // One "today" for the whole render, so a screen left open across midnight
  // cannot sort one row against a different day from the row above it.
  const today = todayIso();
  const { outstanding, completed, isEmpty } = groupTasks(tasks ?? [], today);

  const openAdd = (dueDate: string = today): void => {
    setEditing(null);
    setAddDay(dueDate);
    setIsSheetOpen(true);
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/plots"
          className="text-sm font-medium text-primary-700 underline-offset-2 hover:underline"
        >
          {t('plot.backToList', 'Back to my plots')}
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">
          {t('calendar.title', 'Crop calendar')}
        </h2>
        {plot !== undefined && <p className="text-base text-muted-700">{plot.name}</p>}
      </header>

      {status === 'loading' && tasks === undefined && (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      )}

      {status === 'error' && tasks === undefined && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p role="alert" className="text-sm font-medium text-danger-700">
            {listErrorMessage(error, t)}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void fetchForPlot(plotId);
            }}
          >
            {t('common.retry', 'Try again')}
          </Button>
        </div>
      )}

      {status === 'ready' && isEmpty && (
        <EmptyState
          icon={CalendarDays}
          title={t('calendar.empty.title', 'Nothing planned yet')}
          description={t(
            'calendar.empty.description',
            'Tasks appear here once this plot has a planting date. You can add your own at any time.',
          )}
          action={
            <Button
              className="min-h-touch-lg px-6 text-base"
              onClick={() => {
                openAdd();
              }}
            >
              <Plus className="h-6 w-6" aria-hidden />
              {t('calendar.add.action', 'Add a task')}
            </Button>
          }
        />
      )}

      {!isEmpty && (
        <>
          {TASK_BUCKETS.map((bucket) => (
            <TaskGroup
              key={bucket}
              bucket={bucket}
              tasks={outstanding[bucket]}
              today={today}
              onEdit={(task) => {
                setEditing(task);
                setIsSheetOpen(true);
              }}
            />
          ))}

          <CompletedGroup
            tasks={completed}
            today={today}
            onEdit={(task) => {
              setEditing(task);
              setIsSheetOpen(true);
            }}
          />

          {/* Room for the floating button to sit over, so it never covers the
              last row however far the list is scrolled. */}
          <div className="h-20 lg:hidden" aria-hidden />

          <button
            type="button"
            onClick={() => {
              openAdd();
            }}
            className="btn-primary fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-10 min-h-touch-lg rounded-full px-5 text-base shadow-lg lg:bottom-8 lg:right-8"
          >
            <Plus className="h-6 w-6" aria-hidden />
            {t('calendar.add.action', 'Add a task')}
          </button>
        </>
      )}

      {/* Keyed, so opening a different task rebuilds the form rather than
          leaving react-hook-form holding the previous one's values. */}
      <TaskSheet
        key={editing?._id ?? `new-${addDay}`}
        open={isSheetOpen}
        plotId={plotId}
        task={editing}
        defaultDueDate={addDay}
        onClose={() => {
          setIsSheetOpen(false);
          setEditing(null);
        }}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const BUCKET_TEXT: Record<TaskBucket, { key: string; fallback: string }> = {
  overdue: { key: 'calendar.bucket.overdue', fallback: 'Overdue' },
  today: { key: 'calendar.bucket.today', fallback: 'Today' },
  week: { key: 'calendar.bucket.week', fallback: 'This week' },
  later: { key: 'calendar.bucket.later', fallback: 'Later' },
};

function TaskGroup({
  bucket,
  tasks,
  today,
  onEdit,
}: {
  bucket: TaskBucket;
  tasks: readonly CalendarTaskRecord[];
  today: string;
  onEdit: (task: CalendarTaskRecord) => void;
}): ReactElement | null {
  const { t } = useTranslation();

  // An empty bucket is not shown at all. Four headings with nothing under
  // three of them is a screen that looks broken.
  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <h3
        className={cx(
          'text-sm font-semibold uppercase tracking-wide',
          bucket === 'overdue' ? 'text-danger-700' : 'text-muted-700',
        )}
      >
        {t(BUCKET_TEXT[bucket].key, BUCKET_TEXT[bucket].fallback)}
      </h3>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task._id}>
            <TaskRow task={task} today={today} overdue={bucket === 'overdue'} onEdit={onEdit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompletedGroup({
  tasks,
  today,
  onEdit,
}: {
  tasks: readonly CalendarTaskRecord[];
  today: string;
  onEdit: (task: CalendarTaskRecord) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      {/* A plain disclosure rather than `<details>`: the open state has to
          survive a task being re-opened, which re-renders the list. */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        aria-expanded={isOpen}
        className="flex min-h-touch-md items-center gap-2 rounded-lg px-1 text-sm font-semibold uppercase tracking-wide text-muted-700 hover:bg-muted-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ChevronDown
          className={cx('h-5 w-5 transition-transform', !isOpen && '-rotate-90')}
          aria-hidden
        />
        {t('calendar.bucket.done', { defaultValue: 'Done ({{count}})', count: tasks.length })}
      </button>

      {isOpen && (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task._id}>
              <TaskRow task={task} today={today} overdue={false} onEdit={onEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One task: what it is, when it is due, and the tick.
 *
 * Two targets side by side rather than one. The body of the row opens the
 * editor; the tick completes the task and does nothing else. They are
 * separated because they are taken in opposite circumstances — the tick
 * standing in the field with muddy hands, the editor sitting down — and a
 * mis-tap between them costs a farmer either a lost record or an unwanted
 * edit screen.
 */
function TaskRow({
  task,
  today,
  overdue,
  onEdit,
}: {
  task: CalendarTaskRecord;
  today: string;
  overdue: boolean;
  onEdit: (task: CalendarTaskRecord) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { activityName } = useTaskFields();
  const completeTask = useCalendarStore((state) => state.completeTask);
  const reopenTask = useCalendarStore((state) => state.reopenTask);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDone = task.completedOn !== null;
  const Icon = ACTIVITY_META[task.type].icon;
  const notes = taskNotes(task, t);

  const toggle = async (): Promise<void> => {
    setError(null);
    setIsSaving(true);
    try {
      await (isDone ? reopenTask(task._id) : completeTask(task._id));
    } catch (cause) {
      setError(completeErrorMessage(cause, t));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={cx(
        'flex items-stretch gap-1 rounded-xl border bg-white shadow-sm',
        overdue ? 'border-danger-300' : 'border-muted-200',
        isDone && 'opacity-70',
      )}
    >
      <button
        type="button"
        onClick={() => {
          onEdit(task);
        }}
        className="flex min-h-touch-lg flex-1 items-center gap-3 rounded-l-xl p-3 text-left hover:bg-muted-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span
          className={cx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            overdue ? 'bg-danger-50 text-danger-700' : 'bg-primary-50 text-primary-700',
          )}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cx(
              'truncate text-base font-semibold text-gray-900',
              isDone && 'line-through decoration-muted',
            )}
          >
            {taskTitle(task, t)}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-sm">
            {/* Never the icon alone: the activity is named in words too. */}
            <span className="text-muted-700">{activityName(task.type)}</span>
            <span className={cx('font-medium', overdue ? 'text-danger-700' : 'text-muted-700')}>
              {isDone && task.completedOn !== null
                ? t('calendar.doneOn', {
                    defaultValue: 'Done {{date}}',
                    date: formatDayRelative(task.completedOn, today),
                  })
                : formatDayRelative(task.dueDate, today)}
            </span>
          </span>
          {notes !== '' && !isDone && <span className="truncate text-sm text-muted">{notes}</span>}
          {error !== null && (
            <span role="alert" className="text-sm font-medium text-danger-700">
              {error}
            </span>
          )}
        </span>

        <Pencil className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </button>

      {/* The tick. A 48px square of its own, hard against the edge of the card
          where a right thumb lands. */}
      <button
        type="button"
        disabled={isSaving}
        aria-pressed={isDone}
        onClick={() => {
          void toggle();
        }}
        className={cx(
          'flex min-h-touch-lg w-14 shrink-0 items-center justify-center rounded-r-xl border-l transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          isDone
            ? 'border-primary-200 bg-primary-50 text-primary-700'
            : 'border-muted-200 text-muted-700 hover:bg-primary-50 hover:text-primary-700',
          isSaving && 'opacity-50',
        )}
      >
        {isDone ? (
          <Undo2 className="h-7 w-7" aria-hidden />
        ) : (
          <Check className="h-8 w-8" aria-hidden />
        )}
        <span className="sr-only">
          {isDone
            ? t('calendar.reopen', {
                defaultValue: 'Mark "{{title}}" as not done',
                title: taskTitle(task, t),
              })
            : t('calendar.complete', {
                defaultValue: 'Mark "{{title}}" as done',
                title: taskTitle(task, t),
              })}
        </span>
      </button>
    </div>
  );
}

function MissingPlot(): ReactElement {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={ListTodo}
      title={t('plot.error.gone', 'This plot is no longer there. It may have been deleted.')}
      action={
        <Link to="/plots" className="btn-secondary">
          {t('plot.backToList', 'Back to my plots')}
        </Link>
      }
    />
  );
}
