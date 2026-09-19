import type { CalendarTaskRecord } from '@agrisense/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, ChevronDown, MapPin, Pencil, Sprout } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { calendarKeys, fetchPlotTasks } from '@/api/calendar';
// Deep imports rather than the calendar barrel, which would pull the task
// sheet -- react-hook-form with it -- into this chunk.
import { ACTIVITY_META, taskTitle } from '@/features/calendar/activity';
import { GenerateSheet } from '@/features/calendar/GenerateSheet';
import { useTaskFields } from '@/features/calendar/fields';
import {
  defaultOpenStage,
  groupByStage,
  stageName,
  OTHER_STAGE,
  type StageGroup,
  type StageKey,
} from '@/features/calendar/stages';
import { Button, ConfirmDialog, EmptyState, Spinner } from '@/shared/components';
import { formatDay, formatDayRelative, todayIso } from '@/shared/i18n/dates';
import { cx } from '@/shared/utils/cx';

import { usePlotFields } from './fields';
import { usePlotStore, type Plot } from './plotStore';
import { cropStage } from './progress';

/**
 * `/plots/:id` — one plot, and the season planned on it.
 *
 * The screen the calendar is *built* from, which is what makes it a screen at
 * all: until Day 12 a plot had nothing to show that its edit form did not
 * already hold, and tapping a card went straight to the form. Generating a
 * season is not an edit — it is a decision about the whole plot, taken once
 * and occasionally taken again — and it needed somewhere to live that a farmer
 * could not reach by accident while correcting a plot's name.
 *
 * Below the action, the season as it stands: every task grouped by growth
 * stage, each group collapsed, the stage the plot is in today open. Nineteen
 * tasks in one list is a scroll; five stages with one of them open is a
 * glance, and the one that is open is the one the farmer is standing in.
 *
 * Ticking work off is not done here. That is the calendar screen's job, which
 * is one tap away and built for a thumb in a field; this screen is the plan.
 */
export function PlotDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();

  // The route cannot match without one; this is the type narrowing, not a
  // state the screen can reach.
  return id === undefined ? <MissingPlot /> : <PlotDetail plotId={id} />;
}

/* -------------------------------------------------------------------------- */

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

function PlotDetail({ plotId }: { plotId: string }): ReactElement {
  const { t } = useTranslation();
  const { cropName } = usePlotFields();
  const plot = usePlotStore((state) => state.plots.find((candidate) => candidate._id === plotId));
  const fetchPlot = usePlotStore((state) => state.fetchPlot);

  // The usual way in is a tap on a card, so the plot is already in the store.
  // This covers a link opened cold -- a bookmark, a reload on this screen --
  // and fetches the one plot rather than the list, which may be several pages
  // long. The same arrangement as `PlotFormPage`.
  const [state, setState] = useState<LoadState>(plot === undefined ? 'loading' : 'ready');

  useEffect(() => {
    if (plot !== undefined) {
      setState('ready');
      return;
    }
    if (state !== 'loading') {
      return;
    }

    const abandoned = new AbortController();
    void (async () => {
      const result = await fetchPlot(plotId);
      if (!abandoned.signal.aborted) {
        setState(result);
      }
    })();

    return () => {
      abandoned.abort();
    };
  }, [plotId, plot, state, fetchPlot]);

  if (plot === undefined) {
    if (state === 'missing') {
      return <MissingPlot />;
    }
    if (state === 'error') {
      return (
        <section className="flex flex-col items-center gap-3 py-10 text-center">
          <p role="alert" className="text-sm font-medium text-danger-700">
            {t('plot.error.load', 'Your plots could not be loaded. Check your connection.')}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setState('loading');
            }}
          >
            {t('common.retry', 'Try again')}
          </Button>
          <Link to="/plots" className="btn-secondary">
            {t('plot.backToList', 'Back to my plots')}
          </Link>
        </section>
      );
    }
    return (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <Link
        to="/plots"
        className="text-sm font-medium text-primary-700 underline-offset-2 hover:underline"
      >
        {t('plot.backToList', 'Back to my plots')}
      </Link>

      <PlotHeader plot={plot} cropName={cropName} />
      <PlotSeason plot={plot} />
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Name, crop, size, and the day the crop went in.
 *
 * The sowing date is spelled out even when there is none, because "not set" is
 * the answer to the question this screen's main action asks, and a line that
 * appears only sometimes is a line a farmer has to go looking for.
 */
function PlotHeader({
  plot,
  cropName,
}: {
  plot: Plot;
  cropName: (crop: Plot['crop']) => string;
}): ReactElement {
  const { t } = useTranslation();
  const stage = cropStage(plot);

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 break-words text-xl font-semibold text-gray-900">
          {plot.name}
        </h2>
        {/* Editing is still a form of its own; this is the way back to it now
            that the card opens this screen instead. */}
        <Link
          to={`/plots/${plot._id}/edit`}
          className="btn-secondary min-h-touch-md shrink-0 px-4"
          aria-label={t('plot.edit.title', 'Edit plot')}
        >
          <Pencil className="h-5 w-5" aria-hidden />
          {t('plot.editAction', 'Edit')}
        </Link>
      </div>

      <p className="text-base text-muted-700">
        {cropName(plot.crop)} ·{' '}
        {t('plot.value.acres', { defaultValue: '{{count}} acres', count: plot.areaAcres })}
      </p>

      <p className="flex items-center gap-2 text-base text-muted-700">
        <Sprout className="h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        {plot.sowingDate == null
          ? t('plot.sowing.none', 'Sowing date not set')
          : t('plot.sowing.on', {
              defaultValue: 'Sown {{date}}',
              date: formatDay(plot.sowingDate),
            })}
      </p>

      {stage !== null && !stage.isFuture && (
        <p className="text-sm text-muted-700">
          {stage.isComplete
            ? t('calendar.stageDone', 'Ready to harvest')
            : t('calendar.stage', {
                defaultValue: 'Day {{day}} of {{total}}',
                day: stage.day,
                total: stage.total,
              })}
        </p>
      )}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The season: the button that builds it, and what it currently holds.
 *
 * The button says "Build calendar" when there is nothing yet and "Build again"
 * when there is, and the second one asks first. A rebuild is not destructive
 * in the way a delete is — the server keeps everything the farmer has touched,
 * and clears only generated tasks that are still pending and unedited — but it
 * does replace a plan they may have been working to, and the confirmation is
 * where that promise is made in words they can read before they agree to it.
 */
function PlotSeason({ plot }: { plot: Plot }): ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const tasks = useQuery({
    queryKey: calendarKeys.plot(plot._id),
    queryFn: () => fetchPlotTasks(plot._id),
  });

  const hasCalendar = (tasks.data ?? []).length > 0;

  return (
    <>
      <Button
        className="min-h-touch-lg w-full text-base"
        variant={hasCalendar ? 'secondary' : 'primary'}
        onClick={() => {
          if (hasCalendar) {
            setIsConfirming(true);
          } else {
            setIsSheetOpen(true);
          }
        }}
      >
        <CalendarPlus className="h-6 w-6" aria-hidden />
        {hasCalendar
          ? t('calendar.generate.rebuildAction', 'Build calendar again')
          : t('calendar.generate.action', 'Build calendar')}
      </Button>

      <ConfirmDialog
        open={isConfirming}
        title={t('calendar.generate.confirm.title', 'Build this calendar again?')}
        description={t(
          'calendar.generate.confirm.description',
          'Work you have already done, skipped or changed is kept. Only tasks still waiting, exactly as they were planned, are replaced.',
        )}
        confirmLabel={t('calendar.generate.confirm.confirm', 'Build again')}
        cancelLabel={t('calendar.generate.confirm.cancel', 'Keep this calendar')}
        confirmVariant="primary"
        onConfirm={() => {
          setIsConfirming(false);
          setIsSheetOpen(true);
        }}
        onCancel={() => {
          setIsConfirming(false);
        }}
      />

      {/* Mounted only while open, so the batch id inside it is minted once per
          opening and reused by every retry within it. See `GenerateSheet`. */}
      {isSheetOpen && (
        <GenerateSheet
          plotId={plot._id}
          sowingDate={plot.sowingDate}
          isRebuild={hasCalendar}
          onClose={() => {
            setIsSheetOpen(false);
          }}
        />
      )}

      {tasks.isPending && (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      )}

      {tasks.isError && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p role="alert" className="text-sm font-medium text-danger-700">
            {t('calendar.error.load', 'Your tasks could not be loaded. Check your connection.')}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void tasks.refetch();
            }}
          >
            {t('common.retry', 'Try again')}
          </Button>
        </div>
      )}

      {tasks.isSuccess && !hasCalendar && (
        <EmptyState
          icon={CalendarDays}
          title={t('calendar.empty.title', 'Nothing planned yet')}
          description={t(
            'calendar.generate.empty',
            'Tell us the day this crop was sown and the whole season is planned out for you.',
          )}
        />
      )}

      {hasCalendar && (
        <>
          <StageList plot={plot} tasks={tasks.data ?? []} />
          <Link
            to={`/plots/${plot._id}/calendar`}
            className="btn-secondary min-h-touch-md w-full text-base"
          >
            <CalendarDays className="h-5 w-5" aria-hidden />
            {t('calendar.openFull', 'Open the calendar')}
          </Link>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Every task, cut into growth stages.
 *
 * Which groups are open is held as a set rather than a single key, so a farmer
 * comparing two stages does not have to shut one to read the other. `null`
 * means nobody has touched it yet, and is what lets the current stage open
 * itself the moment the tasks arrive — a `useState` initialiser could not, as
 * it runs a render before the fetch lands.
 */
function StageList({
  plot,
  tasks,
}: {
  plot: Plot;
  tasks: readonly CalendarTaskRecord[];
}): ReactElement {
  const [opened, setOpened] = useState<ReadonlySet<StageKey> | null>(null);

  // One "today" for the whole list, so a screen left open across midnight
  // cannot put one group in one stage and the next in another.
  const today = todayIso();
  const groups = groupByStage(tasks, plot, today);
  const open = opened ?? new Set<StageKey>([defaultOpenStage(groups)].filter(isStageKey));

  return (
    <ul className="flex flex-col gap-2">
      {groups.map((group) => (
        <li key={group.key}>
          <StageSection
            group={group}
            today={today}
            isOpen={open.has(group.key)}
            onToggle={() => {
              setOpened(toggled(open, group.key));
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function StageSection({
  group,
  today,
  isOpen,
  onToggle,
}: {
  group: StageGroup;
  today: string;
  isOpen: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="overflow-hidden rounded-xl border border-muted-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-h-touch-md w-full items-center gap-3 p-3 text-left hover:bg-muted-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <ChevronDown
          className={cx(
            'h-5 w-5 shrink-0 text-muted transition-transform',
            !isOpen && '-rotate-90',
          )}
          aria-hidden
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-gray-900">
              {group.key === OTHER_STAGE
                ? t('calendar.growthStage.other', 'Other tasks')
                : stageName(group.key, t)}
            </span>
            {group.isCurrent && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-sm font-medium text-primary-700">
                {t('calendar.growthStage.now', 'Now')}
              </span>
            )}
          </span>
          <span className="text-sm text-muted-700">
            {group.from !== null &&
              group.to !== null &&
              `${formatDay(group.from, today)} – ${formatDay(group.to, today)} · `}
            {group.outstanding === 0
              ? t('calendar.stageAllDone', 'All done')
              : t('calendar.stageLeft', {
                  defaultValue: '{{count}} left',
                  count: group.outstanding,
                })}
          </span>
        </span>
        {group.overdue > 0 && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-danger-50 px-2.5 py-1 text-sm font-semibold text-danger-700">
            {t('calendar.overdueCount', {
              defaultValue: '{{count}} overdue',
              count: group.overdue,
            })}
          </span>
        )}
      </button>

      {isOpen && (
        <ul className="flex flex-col border-t border-muted-200">
          {group.tasks.map((task) => (
            <li key={task._id} className="border-b border-muted-100 last:border-b-0">
              <TaskLine task={task} today={today} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One planned task: what it is, when it is due, and whether it happened.
 *
 * Not a control. Completing work is done on the calendar screen, where the
 * tick is a 48px target of its own; a row here that toggled on tap would put
 * an irreversible-looking change one mis-scroll away on a screen a farmer
 * opened to read.
 */
function TaskLine({ task, today }: { task: CalendarTaskRecord; today: string }): ReactElement {
  const { t } = useTranslation();
  const { activityName } = useTaskFields();
  const Icon = ACTIVITY_META[task.type].icon;
  const isOverdue = task.status === 'pending' && task.dueDate < today;

  return (
    <div
      className={cx('flex items-center gap-3 px-3 py-3', task.status !== 'pending' && 'opacity-70')}
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
            'break-words text-base font-medium text-gray-900',
            task.status === 'done' && 'line-through decoration-muted',
          )}
        >
          {taskTitle(task, t)}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-sm">
          {/* Never the icon alone: the activity is named in words too. */}
          <span className="text-muted-700">{activityName(task.type)}</span>
          <span className={cx('font-medium', isOverdue ? 'text-danger-700' : 'text-muted-700')}>
            {formatDayRelative(task.dueDate, today)}
          </span>
        </span>
      </span>
      <StatusChip status={task.status} />
    </div>
  );
}

function StatusChip({ status }: { status: CalendarTaskRecord['status'] }): ReactElement | null {
  const { t } = useTranslation();

  if (status === 'pending') {
    return null;
  }

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-medium',
        status === 'done' ? 'bg-primary-50 text-primary-700' : 'bg-muted-100 text-muted-700',
      )}
    >
      {status === 'done'
        ? t('calendar.status.done', 'Done')
        : t('calendar.status.skipped', 'Skipped')}
    </span>
  );
}

function MissingPlot(): ReactElement {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={MapPin}
      title={t('plot.error.gone', 'This plot is no longer there. It may have been deleted.')}
      action={
        <Link to="/plots" className="btn-secondary">
          {t('plot.backToList', 'Back to my plots')}
        </Link>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */

function isStageKey(key: StageKey | null): key is StageKey {
  return key !== null;
}

function toggled(open: ReadonlySet<StageKey>, key: StageKey): ReadonlySet<StageKey> {
  const next = new Set(open);
  if (!next.delete(key)) {
    next.add(key);
  }
  return next;
}
