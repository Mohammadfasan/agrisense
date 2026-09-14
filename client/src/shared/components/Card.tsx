import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '@/shared/utils/cx';

export type CardPadding = 'none' | 'sm' | 'md';

const PADDING_CLASS: Record<CardPadding, string> = {
  // Edge to edge, for a map or photo. Clips children to the rounded corners.
  none: 'overflow-hidden',
  sm: 'p-3',
  md: 'p-4 lg:p-6',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', className, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      className={cx(
        'rounded-xl border border-muted-200 bg-white shadow-sm',
        PADDING_CLASS[padding],
        className,
      )}
    />
  );
});
