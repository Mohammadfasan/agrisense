import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { Button, Spinner } from '@/shared/components';

import { PlotForm } from './PlotForm';
import { usePlotStore } from './plotStore';

/**
 * `/plots/new` and `/plots/:id/edit`.
 *
 * One route component for both, split immediately into two so each has its
 * own hooks: creating needs nothing loaded and editing needs the plot, and a
 * single component doing both would have to run the fetch effect on the
 * create path too and then remember to ignore it.
 */
export function PlotFormPage(): ReactElement {
  const { id } = useParams<{ id: string }>();

  return id === undefined ? <NewPlot /> : <EditPlot id={id} />;
}

/* -------------------------------------------------------------------------- */

function NewPlot(): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">{t('plot.new.title', 'Add a plot')}</h2>
      <PlotForm plot={null} />
    </section>
  );
}

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

function EditPlot({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const plot = usePlotStore((state) => state.plots.find((candidate) => candidate._id === id));
  const fetchPlot = usePlotStore((state) => state.fetchPlot);

  // The list is usually loaded already, because the way in is a tap on a card.
  // A link opened cold -- a bookmark, a reload on this screen -- is what this
  // covers, and it fetches the one plot rather than the list: the plot may be
  // on the third page, and the farmer asked for one thing.
  const [state, setState] = useState<LoadState>(plot === undefined ? 'loading' : 'ready');

  useEffect(() => {
    if (plot !== undefined) {
      setState('ready');
      return;
    }
    // Only ever fetched from `loading`. Without this the plot going away --
    // which is exactly what a successful delete does, a moment before the
    // redirect lands -- would send this effect after a plot it knows is gone.
    if (state !== 'loading') {
      return;
    }

    const abandoned = new AbortController();
    void (async () => {
      const result = await fetchPlot(id);
      // A fetched plot lands in the store, which re-runs this effect with it
      // in hand; the `ready` here is only for the case where it did not.
      // (The controller is only a flag -- the request itself is the store's.)
      if (!abandoned.signal.aborted) {
        setState(result);
      }
    })();

    return () => {
      abandoned.abort();
    };
  }, [id, plot, state, fetchPlot]);

  if (plot !== undefined) {
    return (
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">{t('plot.edit.title', 'Edit plot')}</h2>
        {/* Keyed by id, so opening a different plot rebuilds the form rather
            than leaving react-hook-form holding the previous one's values. */}
        <PlotForm key={plot._id} plot={plot} />
      </section>
    );
  }

  if (state === 'missing' || state === 'error') {
    return (
      <section className="flex flex-col items-center gap-3 py-10 text-center">
        <p role="alert" className="text-sm font-medium text-danger-700">
          {state === 'missing'
            ? t('plot.error.gone', 'This plot is no longer there. It may have been deleted.')
            : t('plot.error.load', 'Your plots could not be loaded. Check your connection.')}
        </p>
        {state === 'error' && (
          <Button
            variant="secondary"
            onClick={() => {
              setState('loading');
            }}
          >
            {t('common.retry', 'Try again')}
          </Button>
        )}
        <Link to="/plots" className="btn-secondary">
          {t('plot.backToList', 'Back to my plots')}
        </Link>
      </section>
    );
  }

  // Loading, or holding still for the half a frame between a delete landing
  // and the redirect to the list.
  return (
    <div className="flex justify-center py-10">
      <Spinner size="lg" />
    </div>
  );
}
