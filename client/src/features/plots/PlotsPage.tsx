import type { CropCode, PlotRecord } from '@agrisense/shared';
import { CalendarDays, ChevronRight, MapPin, Plus } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

// Deep imports, not the feature barrel: that would pull the calendar screen
// and the task sheet -- react-hook-form with them -- into this chunk.
import { ACTIVITY_META, taskTitle } from '@/features/calendar/activity';
import { useCalendarStore } from '@/features/calendar/calendarStore';
import { useNextTask } from '@/features/calendar/useNextTask';
import { Button, EmptyState, Spinner } from '@/shared/components';
import { formatDayRelative, todayIso } from '@/shared/i18n/dates';
import { cx } from '@/shared/utils/cx';

import { listErrorMessage } from './errors';
import { usePlotFields } from './fields';
import { usePlotStore } from './plotStore';
import { cropStage } from './progress';

/**
 * The farmer's plots, as a list of cards.
 *
 * Built for the 360px phone held one-handed at the edge of a field: one card
 * per row rather than a grid, the whole card a tap target, and the way to add
 * a plot fixed above the thumb instead of at the top of a list that may be
 * scrolled away from.
 *
 * Tapping a card opens the plot, not the edit form. That changed with Day 12:
 * a plot now has something to show that its form does not hold -- the season
 * generated on it -- and building that season is a decision about the whole
 * plot rather than a correction to one of its fields. Editing is one tap
 * further in, from the plot's own screen.
 */
export function PlotsPage(): ReactElement {
  const { t } = useTranslation();
  const { cropName } = usePlotFields();
  const plots = usePlotStore((state) => state.plots);
  const status = usePlotStore((state) => state.status);
  const error = usePlotStore((state) => state.error);
  const nextCursor = usePlotStore((state) => state.nextCursor);
  const isLoadingMore = usePlotStore((state) => state.isLoadingMore);
  const ensureLoaded = usePlotStore((state) => state.ensureLoaded);
  const fetchPlots = usePlotStore((state) => state.fetchPlots);
  const fetchMore = usePlotStore((state) => state.fetchMore);

  // One request for every card's "next due" line, rather than one per plot.
  // See `useNextTask`.
  const ensureUpcoming = useCalendarStore((state) => state.ensureUpcoming);

  useEffect(() => {
    void ensureLoaded();
    void ensureUpcoming();
  }, [ensureLoaded, ensureUpcoming]);

  // One "today" for the whole list, so two cards cannot be drawn against
  // different days when the screen is open across midnight.
  const today = todayIso();

  // Only while there is nothing to show. A refresh over a list already on
  // screen leaves it there rather than replacing it with a spinner.
  const isFirstLoad = status === 'loading' && plots.length === 0;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('plot.title', 'My plots')}</h2>

      {isFirstLoad && (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      )}

      {status === 'error' && plots.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p role="alert" className="text-sm font-medium text-danger-700">
            {listErrorMessage(error, t)}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void fetchPlots();
            }}
          >
            {t('common.retry', 'Try again')}
          </Button>
        </div>
      )}

      {status === 'ready' && plots.length === 0 && (
        <EmptyState
          icon={MapPin}
          title={t('plot.empty.title', 'No plots yet')}
          description={t(
            'plot.empty.description',
            'Add your first plot to keep track of what is growing and get warnings for it.',
          )}
          action={
            <Link to="/plots/new" className="btn-primary min-h-touch-lg px-6 text-base">
              <Plus className="h-6 w-6" aria-hidden />
              {t('plot.empty.action', 'Add your first plot')}
            </Link>
          }
        />
      )}

      {plots.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {plots.map((plot) => (
              <li key={plot._id}>
                <PlotCard plot={plot} cropName={cropName} today={today} />
              </li>
            ))}
          </ul>

          {/* A page that would not load. Said here rather than replacing the
              list, which is still good as far as it goes. */}
          {error !== null && (
            <p role="alert" className="text-sm font-medium text-danger-700">
              {listErrorMessage(error, t)}
            </p>
          )}

          {nextCursor !== null && (
            <Button
              variant="secondary"
              className="w-full"
              loading={isLoadingMore}
              onClick={() => {
                void fetchMore();
              }}
            >
              {t('plot.loadMore', 'Show more plots')}
            </Button>
          )}

          {/* Room for the floating button to sit over, so it never covers the
              last card however far the list is scrolled. */}
          <div className="h-20 lg:hidden" aria-hidden />

          <AddPlotButton />
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PlotCard({
  plot,
  cropName,
  today,
}: {
  plot: PlotRecord;
  cropName: (crop: CropCode) => string;
  today: string;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const stage = cropStage(plot, today);

  return (
    // A card of two stacked targets rather than one: the body opens the plot,
    // the strip at the bottom opens its calendar. Both clear 48px, and neither
    // is nested inside the other -- an anchor inside an anchor is not markup a
    // browser or a screen reader can make sense of.
    <div className="flex flex-col overflow-hidden rounded-xl border border-muted-200 bg-white shadow-sm">
      <Link
        to={`/plots/${plot._id}`}
        className="flex items-center gap-3 p-4 transition-colors hover:bg-muted-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-semibold text-gray-900">{plot.name}</span>
          {/* Crop and size on one line: together they are how a farmer tells two
              plots apart at a glance, and apart they are two lines of chrome. */}
          <span className="text-sm text-muted-700">
            {cropName(plot.crop)} ·{' '}
            {t('plot.value.acres', { defaultValue: '{{count}} acres', count: plot.areaAcres })}
          </span>
          <span className="text-sm text-muted-700">
            {plot.plantedAt == null
              ? t('plot.notPlanted', 'Not planted yet')
              : t('plot.planted', {
                  defaultValue: 'Planted {{date}}',
                  date: formatDate(plot.plantedAt, i18n.language),
                })}
          </span>
          {stage !== null && <CropStageBar stage={stage} />}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Link>

      <NextTaskStrip plotId={plot._id} today={today} />
    </div>
  );
}

/**
 * How far through the season this plot is.
 *
 * Computed on every render from `plantedAt` and today, never stored: a saved
 * percentage is wrong by the next morning. `progress.ts` does the arithmetic.
 *
 * The number is spelled out beside the bar -- "Day 34 of 120" -- because a bar
 * on its own is a shape, and a farmer deciding whether to order fertiliser
 * wants the day.
 */
function CropStageBar({ stage }: { stage: ReturnType<typeof cropStage> }): ReactElement | null {
  const { t } = useTranslation();

  if (stage === null || stage.isFuture) {
    return null;
  }

  return (
    <span className="mt-1 flex flex-col gap-1">
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={stage.total}
        aria-valuenow={stage.day}
        aria-label={t('calendar.stage', {
          defaultValue: 'Day {{day}} of {{total}}',
          day: stage.day,
          total: stage.total,
        })}
        className="block h-2 w-full overflow-hidden rounded-full bg-muted-200"
      >
        <span
          className={cx(
            'block h-full rounded-full',
            stage.isComplete ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${String(Math.round(stage.fraction * 100))}%` }}
        />
      </span>
      <span className="text-sm text-muted-700">
        {stage.isComplete
          ? t('calendar.stageDone', 'Ready to harvest')
          : t('calendar.stage', {
              defaultValue: 'Day {{day}} of {{total}}',
              day: stage.day,
              total: stage.total,
            })}
      </span>
    </span>
  );
}

/**
 * The way into this plot's calendar, carrying the next thing due.
 *
 * Overdue work is drawn in the danger colour and named as overdue rather than
 * only dated: "3 Jun" tells a farmer nothing unless they are already counting,
 * and this line is the one place a missed spray can surface on the list screen.
 *
 * With nothing due it is still here, as a plain link. A card that sometimes
 * has a way into the calendar and sometimes does not is a card the farmer has
 * to re-learn every time the season turns over.
 */
function NextTaskStrip({ plotId, today }: { plotId: string; today: string }): ReactElement {
  const { t } = useTranslation();
  const task = useNextTask(plotId);
  const isOverdue = task !== null && task.dueDate < today;
  const Icon = task === null ? CalendarDays : ACTIVITY_META[task.type].icon;

  return (
    <Link
      to={`/plots/${plotId}/calendar`}
      className={cx(
        'flex min-h-touch-md items-center gap-2 border-t px-4 py-2 text-sm transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        isOverdue
          ? 'border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100'
          : 'border-muted-200 text-muted-700 hover:bg-muted-50',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">
        {task === null
          ? t('calendar.open', 'Calendar')
          : t('calendar.nextDue', { defaultValue: 'Next: {{title}}', title: taskTitle(task, t) })}
      </span>
      {task !== null && (
        <span className="shrink-0">
          {isOverdue && (
            <span className="mr-1 font-semibold">{t('calendar.bucket.overdue', 'Overdue')}</span>
          )}
          {formatDayRelative(task.dueDate, today)}
        </span>
      )}
    </Link>
  );
}

function AddPlotButton(): ReactElement {
  const { t } = useTranslation();

  return (
    // Fixed rather than sticky: it stays under the thumb wherever the list is
    // scrolled to. The offset clears the bottom nav and, below it, the iOS
    // home indicator; from `lg:` the nav is a sidebar and neither applies.
    <Link
      to="/plots/new"
      className="btn-primary fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-10 min-h-touch-lg rounded-full px-5 text-base shadow-lg lg:bottom-8 lg:right-8"
    >
      <Plus className="h-6 w-6" aria-hidden />
      {t('plot.add', 'Add plot')}
    </Link>
  );
}

/**
 * The planted date, in the farmer's language.
 *
 * Read back in UTC because that is how it was written — `plantedAt` is a day,
 * stored as midnight UTC, and rendering it in the device's zone would show the
 * day before to anyone west of Greenwich.
 */
function formatDate(date: Date, language: string): string {
  return date.toLocaleDateString(language, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
