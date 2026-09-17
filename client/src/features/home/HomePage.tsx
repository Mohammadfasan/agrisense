import { ChevronRight, LineChart, MapPin, ScanLine, User, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { FEATURES } from '@/app/features';
import { useAuthStore } from '@/features/auth';
// Straight at the store rather than through `@/features/plots`, which would
// pull the plot form -- and react-hook-form with it -- into the chunk for the
// first screen every farmer loads.
import { usePlotStore } from '@/features/plots/plotStore';
import { Spinner } from '@/shared/components';
import { cx } from '@/shared/utils/cx';

/**
 * The first screen after sign-in.
 *
 * Written for one situation and no other: a farmer standing at the edge of a
 * field, sun on the screen, phone in one hand. That rules most things out. No
 * dense dashboard, no numbers small enough to squint at, no action behind an
 * icon a farmer is expected to recognise — every tap target on this screen is
 * at least 48px and carries a word in their own language beside its icon.
 *
 * It is also deliberately close to empty. Recent scans, live prices, a
 * forecast and outbreak alerts all belong here eventually and none of them has
 * a data source before Week 5. A card of invented numbers would be the one
 * mistake this screen cannot recover from: a farmer who learns that a price on
 * this app is made up has no reason to believe the disease warning either.
 *
 * So it shows exactly four things — scan a leaf (Week 5), the plots they
 * already have, market prices (Week 7) and their profile — with the two that
 * do not exist yet marked as such. Each is gated by its flag in
 * `app/features.ts`.
 */
export function HomePage(): ReactElement {
  const { t } = useTranslation();
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);

  // `RequireProfile` guarantees the profile before this renders; the session's
  // own name is the fallback for the render that guard cannot cover, rather
  // than greeting somebody by nothing at all.
  const name = profile?.fullName ?? user?.name ?? '';

  return (
    <section className="flex flex-col gap-4">
      {/* The farmer's own name, first thing. This is a shared phone as often
          as not, and it is the fastest way to see whose account is open. */}
      <h2 className="text-xl font-semibold text-gray-900">
        {t('home.greeting', { defaultValue: 'Hello, {{name}}', name })}
      </h2>

      <ScanCard />
      <PlotsCard />

      {/* Two-up: both fit a thumb at 360px, and neither is important enough to
          take a row of its own from the two above. */}
      <div className="grid grid-cols-2 gap-3">
        <SecondaryTile
          to="/market"
          enabled={FEATURES.prices.enabled}
          icon={LineChart}
          label={t('home.prices.title', 'Market prices')}
        />
        <SecondaryTile
          to="/profile"
          enabled={FEATURES.profile.enabled}
          icon={User}
          label={t('home.profile.title', 'My profile')}
        />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The one thing this app is for, once it can do it.
 *
 * Full width and the tallest thing on the screen, because when the model lands
 * this is the tap that matters and it should be findable without reading.
 * Until then it is dimmed with a "coming soon" beside it rather than hidden:
 * a farmer who was told the app diagnoses leaves should be able to see where
 * that will be, and not conclude the app is broken for not having it.
 *
 * Flipping `FEATURES.scan.enabled` turns it into the solid green primary card
 * it is meant to be, and mounts `/scan` in the router.
 */
function ScanCard(): ReactElement {
  const { t } = useTranslation();
  const enabled = FEATURES.scan.enabled;

  return (
    <ActionSurface
      to="/scan"
      enabled={enabled}
      className={cx(
        'min-h-[7rem] flex-row items-center gap-4 p-5',
        enabled ? 'border-primary bg-primary text-white' : 'bg-white',
      )}
    >
      <span
        className={cx(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-full',
          enabled ? 'bg-primary-700 text-white' : 'bg-muted-100 text-muted',
        )}
      >
        <ScanLine className="h-8 w-8" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cx('text-lg font-semibold', enabled ? 'text-white' : 'text-gray-900')}>
            {t('home.scan.title', 'Scan a leaf')}
          </span>
          {!enabled && <ComingSoonBadge />}
        </span>
        <span className={cx('text-sm', enabled ? 'text-primary-50' : 'text-muted-700')}>
          {t('home.scan.description', 'Photograph a leaf to find disease early.')}
        </span>
      </span>
    </ActionSurface>
  );
}

/**
 * How much land is being tracked, and the way into it.
 *
 * The only card on this screen carrying live numbers, and the numbers are the
 * farmer's own — a count and a sum of what they typed, not a statistic.
 *
 * The total is shown only when the whole list is loaded. `/plots` pages, so
 * summing what happens to be in the store would quietly under-report the acres
 * of anyone past the first page. A partial total looks exactly like a correct
 * one, which is what makes it worse than no total at all.
 */
function PlotsCard(): ReactElement {
  const { t } = useTranslation();
  const plots = usePlotStore((state) => state.plots);
  const status = usePlotStore((state) => state.status);
  const nextCursor = usePlotStore((state) => state.nextCursor);
  const ensureLoaded = usePlotStore((state) => state.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const summary = ((): ReactNode => {
    if (status === 'loading' && plots.length === 0) {
      return <Spinner size="sm" label={t('common.loading', 'Loading')} />;
    }

    // Nothing has loaded, the load failed, or there are more pages behind a
    // cursor. `/plots` is one tap away and reports all three properly.
    if (status !== 'ready' || nextCursor !== null) {
      return t('nav.plots', 'Plots');
    }

    if (plots.length === 0) {
      return t('home.plots.none', 'No plots yet. Tap to add your first.');
    }

    // Acres are entered to two decimals, so the sum is rounded back to two:
    // floating-point addition of 1.2 and 3.4 is otherwise 4.6000000000000005.
    const acres = Math.round(plots.reduce((total, plot) => total + plot.areaAcres, 0) * 100) / 100;

    return t('home.plots.summary', {
      defaultValue: '{{plots}} · {{acres}}',
      plots: t('home.plots.count', { defaultValue: '{{count}} plots', count: plots.length }),
      acres: t('plot.value.acres', { defaultValue: '{{count}} acres', count: acres }),
    });
  })();

  return (
    <ActionSurface
      to="/plots"
      enabled={FEATURES.plots.enabled}
      className="min-h-touch-lg flex-row items-center gap-4 bg-white p-5"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
        <MapPin className="h-7 w-7" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-lg font-semibold text-gray-900">
          {t('home.plots.title', 'My plots')}
        </span>
        <span className="text-sm text-muted-700">{summary}</span>
      </span>
      <ChevronRight className="h-6 w-6 shrink-0 text-muted" aria-hidden />
    </ActionSurface>
  );
}

/** One half of the two-up row: an icon over a word, and nothing else. */
function SecondaryTile({
  to,
  enabled,
  icon: Icon,
  label,
}: {
  to: string;
  enabled: boolean;
  icon: LucideIcon;
  label: string;
}): ReactElement {
  return (
    <ActionSurface
      to={to}
      enabled={enabled}
      className="min-h-[6.5rem] flex-col items-center justify-center gap-2 bg-white p-4 text-center"
    >
      <Icon className={cx('h-8 w-8', enabled ? 'text-primary-700' : 'text-muted')} aria-hidden />
      {/* Never the icon on its own: half this audience reads a word faster
          than they decode a pictogram, and a chart glyph means nothing at all
          until you have seen the screen behind it. */}
      <span className={cx('text-base font-medium', enabled ? 'text-gray-900' : 'text-muted-700')}>
        {label}
      </span>
      {!enabled && <ComingSoonBadge />}
    </ActionSurface>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A card-sized tap target: a link when the feature behind it exists, plain
 * text when it does not.
 *
 * The disabled form is a `<div>` and not a disabled `<button>` or a `<Link>`
 * that goes nowhere. It is not a control yet — the same card becomes a real
 * link the moment its flag flips — so it stays out of the tab order, and the
 * "coming soon" badge carries the explanation for everyone, sighted or not.
 */
function ActionSurface({
  to,
  enabled,
  className,
  children,
}: {
  to: string;
  enabled: boolean;
  className: string;
  children: ReactNode;
}): ReactElement {
  // No direction here on purpose: a caller passing `flex-row` cannot override
  // a `flex-col` in the base, because the two utilities have equal specificity
  // and Tailwind's own output order decides which wins, not the class string's.
  const base = 'flex rounded-2xl border border-muted-200 shadow-sm';

  if (!enabled) {
    return (
      <div aria-disabled="true" className={cx(base, className)}>
        {children}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className={cx(
        base,
        'transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
    >
      {children}
    </Link>
  );
}

function ComingSoonBadge(): ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-warning-100 px-2.5 py-1 text-sm font-medium text-warning-900">
      {t('common.comingSoon', 'Coming soon')}
    </span>
  );
}
