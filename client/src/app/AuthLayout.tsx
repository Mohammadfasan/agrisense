import { Leaf, LineChart, MapPin, ScanLine } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';

const HIGHLIGHTS = [
  {
    icon: ScanLine,
    key: 'auth.panel.scan',
    fallback: 'Scan a leaf to spot disease early',
  },
  {
    icon: MapPin,
    key: 'auth.panel.plots',
    fallback: 'Keep every plot and harvest in one place',
  },
  {
    icon: LineChart,
    key: 'auth.panel.market',
    fallback: 'Check market prices before you sell',
  },
] as const;

/**
 * The signed-out shell. On phones it is a centered card. From `lg:` it splits
 * into a brand panel on the left and the form on the right.
 *
 * The brand appears twice, once per breakpoint, and CSS hides the other one.
 * `display: none` also removes it from the accessibility tree, so screen
 * readers only ever hear one `h1`.
 */
export function AuthLayout({ children }: { children?: ReactNode }): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-muted-50 lg:grid lg:grid-cols-2 lg:bg-white">
      <section className="hidden flex-col justify-between bg-primary-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <Leaf className="h-8 w-8" aria-hidden />
          <h1 className="text-xl font-semibold">{t('app.name', 'AgriSense')}</h1>
        </div>

        <div className="flex max-w-md flex-col gap-8">
          <p className="text-3xl font-semibold leading-tight">
            {t('app.tagline', 'Smarter decisions for every field.')}
          </p>
          <ul className="flex flex-col gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, key, fallback }) => (
              <li key={key} className="flex items-center gap-3 text-primary-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {t(key, fallback)}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-primary-100">
          {t('auth.panel.footer', 'Built for farmers in Sri Lanka.')}
        </p>
      </section>

      <div className="flex min-h-dvh items-center justify-center p-4 sm:p-6 lg:p-12">
        <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-muted-200 bg-white p-6 shadow-sm lg:border-0 lg:p-0 lg:shadow-none">
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <Leaf className="h-10 w-10 text-primary" aria-hidden />
            <h1 className="text-2xl font-semibold">{t('app.name', 'AgriSense')}</h1>
          </div>
          {children ?? <Outlet />}
        </div>
      </div>
    </div>
  );
}
