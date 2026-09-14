import { forwardRef, useId, type InputHTMLAttributes } from 'react';

import { cx } from '@/shared/utils/cx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Required: a placeholder disappears on typing and is not a label. */
  label: string;
  hint?: string;
  /** Shown below the field, which is marked invalid while it is set. */
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, 'aria-describedby': describedByProp, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = cx(describedByProp, hint && hintId, error && errorId) || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-900">
        {label}
      </label>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          // 16px text: anything smaller and iOS zooms the page on focus.
          'block min-h-touch w-full rounded-lg border bg-white px-3 text-base text-gray-900',
          'transition-colors placeholder:text-muted focus:outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:bg-muted-100 disabled:text-muted',
          error
            ? 'border-danger focus:border-danger focus:ring-danger-200'
            : 'border-muted-300 focus:border-primary focus:ring-primary-200',
          className,
        )}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
});
