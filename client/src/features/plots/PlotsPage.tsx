import type { CropCode, PlotRecord } from '@agrisense/shared';
import { ChevronRight, MapPin, Plus } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button, EmptyState, Spinner } from '@/shared/components';

import { listErrorMessage } from './errors';
import { usePlotFields } from './fields';
import { usePlotStore } from './plotStore';

/**
 * The farmer's plots, as a list of cards.
 *
 * Built for the 360px phone held one-handed at the edge of a field: one card
 * per row rather than a grid, the whole card a tap target, and the way to add
 * a plot fixed above the thumb instead of at the top of a list that may be
 * scrolled away from.
 *
 * Tapping a card opens the edit form. There is no separate read-only detail
 * screen: everything a plot currently holds fits on the form, and a screen
 * whose only content is a row of values with an Edit button above them is one
 * tap of overhead per change.
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

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

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
                <PlotCard plot={plot} cropName={cropName} />
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
}: {
  plot: PlotRecord;
  cropName: (crop: CropCode) => string;
}): ReactElement {
  const { t, i18n } = useTranslation();

  return (
    <Link
      to={`/plots/${plot._id}/edit`}
      className="flex items-center gap-3 rounded-xl border border-muted-200 bg-white p-4 shadow-sm transition-colors hover:bg-muted-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
          {plot.plantedAt === undefined
            ? t('plot.notPlanted', 'Not planted yet')
            : t('plot.planted', {
                defaultValue: 'Planted {{date}}',
                date: formatDate(plot.plantedAt, i18n.language),
              })}
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
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
