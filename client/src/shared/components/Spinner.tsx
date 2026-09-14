import { LoaderCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '@/shared/utils/cx';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Announced to screen readers. Defaults to a translated "Loading". */
  label?: string;
  /**
   * Hide it from assistive tech, for when something else already says what is
   * happening — a busy button, for instance.
   */
  decorative?: boolean;
  className?: string;
}

/** Takes its colour from the surrounding text, so it works on any surface. */
export function Spinner({
  size = 'md',
  label,
  decorative = false,
  className,
}: SpinnerProps): ReactElement {
  const { t } = useTranslation();
  const icon = <LoaderCircle className={cx('animate-spin', SIZE_CLASS[size])} aria-hidden />;

  if (decorative) {
    return <span className={cx('inline-flex', className)}>{icon}</span>;
  }

  return (
    <span role="status" className={cx('inline-flex', className)}>
      {icon}
      <span className="sr-only">{label ?? t('common.loading', 'Loading')}</span>
    </span>
  );
}
