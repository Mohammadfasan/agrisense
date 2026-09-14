import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

export function PlotDetailPage(): ReactElement {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  return (
    <h2 className="text-xl font-semibold">
      {t('plot.title', 'Plot')} {id}
    </h2>
  );
}
