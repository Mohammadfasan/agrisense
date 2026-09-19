import type { ReactElement } from 'react';

import { cx } from '@/shared/utils/cx';

export interface SkeletonProps {
  /** Sizing and shape, e.g. `h-4 w-32 rounded`. */
  className?: string;
}

/**
 * A grey bar standing in for content that is on its way.
 *
 * Used instead of a spinner wherever the shape of the answer is already known
 * — a card of three rows stays a card of three rows while it loads, so the
 * screen does not jump when the data lands and the farmer is not looking at a
 * turning circle wondering how much is coming. A spinner is still right where
 * the shape is not known, or where the wait is a button's own.
 *
 * `aria-hidden`, and deliberately: this is a picture of a row, not a row. The
 * surrounding region says it is busy, and a screen reader that announced three
 * empty bars would be reading out the decoration.
 */
export function Skeleton({ className }: SkeletonProps): ReactElement {
  return (
    <span
      aria-hidden
      className={cx('block animate-pulse bg-muted-200 motion-reduce:animate-none', className)}
    />
  );
}
