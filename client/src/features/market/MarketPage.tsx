import type { ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { db } from '@/db';

export function MarketPage(): ReactElement {
  const { t } = useTranslation();
  const prices = useLiveQuery(() => db.marketPrices.orderBy('recordedAt').toArray(), [], []);

  const series = prices.map((price) => ({
    date: new Date(price.recordedAt).toLocaleDateString(),
    price: price.pricePerKg,
  }));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('market.title', 'Market prices')}</h2>

      {series.length === 0 ? (
        <p className="text-muted">{t('market.empty', 'No price data cached yet.')}</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="price" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
