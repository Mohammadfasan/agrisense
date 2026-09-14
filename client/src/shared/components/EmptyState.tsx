import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { cx } from '@/shared/utils/cx';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Usually the one button that fills the empty space, e.g. "Add plot". */
  action?: ReactNode;
  className?: string;
}

/** What a list or screen shows when it has nothing in it yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted-100 text-muted">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      )}
      <div className="flex max-w-xs flex-col gap-1">
        {/* Not a heading: it sits inside pages whose outline it cannot know. */}
        <p className="font-semibold text-gray-900">{title}</p>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
