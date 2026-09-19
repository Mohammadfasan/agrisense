import type { CalendarTodayTask } from '@agrisense/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, ListTodo } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { calendarKeys, fetchToday } from '@/api/calendar';
// Straight at the modules rather than through the calendar barrel, which would
// pull the task sheet -- react-hook-form with it -- into the chunk for the
// first screen every farmer loads.
import { ACTIVITY_META, taskTitle } from '@/features/calendar/activity';
import { usePlotStore } from '@/features/plots/plotStore';
import { useTaskMutation } from '@/hooks/useTaskMutation';
import { EmptyState, Skeleton } from '@/shared/components';
import { formatDayRelative, todayIso } from '@/shared/i18n/dates';
import { cx } from '@/shared/utils/cx';

/** How many rows the card shows per bucket before it stops. */
const ROW_LIMIT = 3;

/**
 * What is late and what is due today, across every plot.
 *
 * **The server decides what is late.** Sri Lanka is UTC+05:30, so a client
 * that bucketed the tasks itself would disagree with the server for five and a
 * half hours out of every twenty-four; the phone sends the day it is where the
 * farmer is standing, and the server answers with three buckets and the day it
 * used. Nothing here re-derives them.
 *
 * **Overdue leads, in red, as a count.** It is the only number on this screen
 * that is bad news, and a farmer who has missed a spray needs to see that
 * before they see anything else. The rows follow so the count is something
 * they can act on rather than only worry about.
 *
 * **A row is the tick.** The whole row toggles the task between done and
 * waiting, optimistically, through `useTaskMutation` — the same hook every
 * other surface uses and the one Week 6's sync will replay through. Tapping a
 * row is the single most common thing a farmer does with this app, and giving
 * it the whole 48px row rather than a target inside one is what makes it
 * possible with a thumb, in sunlight, one-handed.
 *
 * **Skeletons, not a spinner.** The card's shape is known before its contents
 * are, so it keeps that shape while it loads and nothing jumps when the answer
 * lands.
 */
export function TodayCard(): ReactElement {
  const { t } = useTranslation();

  // One "today" for the whole render: the query is keyed by it, and every row
  // is dated against it, so a screen left open across midnight cannot label
  // one row from one day and the next from another.
  const today = todayIso();

  const buckets = useQuery({
    queryKey: calendarKeys.today(today),
    queryFn: () => fetchToday(today),
  });

  const plots = usePlotStore((state) => state.plots);
  const ensureLoaded = usePlotStore((state) => state.ensureLoaded);
  const mutation = useTaskMutation();

  useEffect(() => {
    // For the empty state's link, which offers a plot by name. The card below
    // this one loads the same list; `ensureLoaded` makes the second call free.
    void ensureLoaded();
  }, [ensureLoaded]);

  const data = buckets.data;
  const isEmpty = data?.overdue.length === 0 && data.today.length === 0 && data.next7.length === 0;

  return (
    <section
      aria-busy={buckets.isPending || undefined}
      className="flex flex-col overflow-hidden rounded-2xl border border-muted-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <ListTodo className="h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <h3 className="flex-1 text-base font-semibold text-gray-900">
          {t('home.today.title', 'Today')}
        </h3>
        {data !== undefined && data.overdue.length > 0 && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-danger-50 px-3 py-1 text-sm font-semibold text-danger-700">
            {t('calendar.overdueCount', {
              defaultValue: '{{count}} overdue',
              count: data.overdue.length,
            })}
          </span>
        )}
      </div>

      {buckets.isPending && <TodaySkeleton />}

      {buckets.isError && (
        <p role="alert" className="px-4 pb-4 text-sm font-medium text-danger-700">
          {t('calendar.error.load', 'Your tasks could not be loaded. Check your connection.')}
        </p>
      )}

      {isEmpty && <TodayEmpty firstPlotId={plots[0]?._id} />}

      {data !== undefined && !isEmpty && (
        <>
          <ul className="flex flex-col">
            {[...data.overdue.slice(0, ROW_LIMIT), ...data.today.slice(0, ROW_LIMIT)].map(
              (task) => (
                <li key={task._id} className="border-t border-muted-200">
                  <TaskRow
                    task={task}
                    today={today}
                    busy={mutation.isPending && mutation.variables.task._id === task._id}
                    onToggle={() => {
                      mutation.mutate({
                        task,
                        status: task.status === 'done' ? 'pending' : 'done',
                      });
                    }}
                  />
                </li>
              ),
            )}
          </ul>

          {data.overdue.length === 0 && data.today.length === 0 && (
            <p className="border-t border-muted-200 px-4 py-3 text-base text-muted-700">
              {t('home.today.none', 'Nothing due today.')}
            </p>
          )}

          {data.next7.length > 0 && (
            <p className="border-t border-muted-200 px-4 py-3 text-sm text-muted-700">
              {t('home.today.next7', {
                defaultValue: '{{count}} more in the next 7 days',
                count: data.next7.length,
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One task, as a single tap target.
 *
 * `aria-pressed` rather than a checkbox: it is a button whose state is "done",
 * which is what a screen reader should say when it lands on it. The tick on
 * the right is the visible half of the same thing, and never the only half —
 * the title is struck through too, because a small green mark is not
 * something to read a decision off in sunlight.
 */
function TaskRow({
  task,
  today,
  busy,
  onToggle,
}: {
  task: CalendarTodayTask;
  today: string;
  busy: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const isDone = task.status === 'done';
  const isOverdue = task.status === 'pending' && task.dueDate < today;
  const Icon = ACTIVITY_META[task.type].icon;

  return (
    <button
      type="button"
      aria-pressed={isDone}
      disabled={busy}
      onClick={onToggle}
      className={cx(
        'flex min-h-touch-lg w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        'hover:bg-muted-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        busy && 'opacity-60',
      )}
    >
      <span
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          isOverdue ? 'bg-danger-50 text-danger-700' : 'bg-primary-50 text-primary-700',
        )}
      >
        <Icon className="h-6 w-6" aria-hidden />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cx(
            'truncate text-base font-medium text-gray-900',
            isDone && 'line-through decoration-muted',
          )}
        >
          {taskTitle(task, t)}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          {/* The plot's name, joined by the endpoint: "spray for thrips" means
              nothing until you know which field. */}
          <span className="truncate text-muted-700">{task.plotName}</span>
          <span className={cx('font-medium', isOverdue ? 'text-danger-700' : 'text-muted-700')}>
            {isOverdue && `${t('calendar.bucket.overdue', 'Overdue')} · `}
            {formatDayRelative(task.dueDate, today)}
          </span>
        </span>
      </span>

      <span
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2',
          isDone ? 'border-primary bg-primary text-white' : 'border-muted-300 text-transparent',
        )}
      >
        <Check className="h-6 w-6" aria-hidden />
      </span>
    </button>
  );
}

/** The card's own shape, held while the answer is on its way. */
function TodaySkeleton(): ReactElement {
  return (
    <div className="flex flex-col">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex min-h-touch-lg items-center gap-3 border-t border-muted-200 px-4 py-3"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing due, anywhere.
 *
 * Shown rather than hiding the card, unlike the list it replaces: with a
 * calendar generated, "nothing due" is real news — the farmer is up to date —
 * and with no calendar generated it is the prompt to make one, which is why
 * the link goes to a plot rather than to the plot list.
 */
function TodayEmpty({ firstPlotId }: { firstPlotId: string | undefined }): ReactElement {
  const { t } = useTranslation();

  return (
    <EmptyState
      title={t('home.today.empty.title', 'Nothing due')}
      description={t(
        'home.today.empty.description',
        'Work appears here once a plot has its season planned.',
      )}
      action={
        <Link
          to={firstPlotId === undefined ? '/plots/new' : `/plots/${firstPlotId}`}
          className="btn-secondary min-h-touch-md px-5 text-base"
        >
          {firstPlotId === undefined
            ? t('plot.empty.action', 'Add your first plot')
            : t('home.today.empty.action', 'Plan a season')}
        </Link>
      }
    />
  );
}
