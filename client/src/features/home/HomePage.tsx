import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export function HomePage(): ReactElement {
  const { t } = useTranslation();

  return <h2 className="text-xl font-semibold">{t('home.title', 'Home')}</h2>;
}
