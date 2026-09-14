import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cx } from '@/shared/utils/cx';

import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/** The look lives in `shared/styles/index.css`, so plain-class callers match. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Disables the button and swaps the label for a spinner. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    loading = false,
    disabled = false,
    // A bare <button> inside a form submits it. Opt in to that, not out.
    type = 'button',
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(VARIANT_CLASS[variant], 'relative', className)}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" decorative />
        </span>
      )}
      {/* Faded rather than removed, so the button keeps its width and its
          accessible name while the spinner shows. */}
      <span className={cx('inline-flex items-center gap-2', loading && 'opacity-0')}>
        {children}
      </span>
    </button>
  );
});
