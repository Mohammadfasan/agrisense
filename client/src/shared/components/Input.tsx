import { forwardRef, useId, type InputHTMLAttributes, type ReactElement } from 'react';

import { cx } from '@/shared/utils/cx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Required: a placeholder disappears on typing and is not a label. */
  label: string;
  hint?: string;
  /** Shown below the field, which is marked invalid while it is set. */
  error?: string;
  /**
   * Fixed text inside the field, ahead of the value -- a dialling code, a
   * currency. Not part of the value: it is never submitted and cannot be
   * edited or deleted. Read out with the field, so `+94` is announced rather
   * than silently prepended.
   */
  prefix?: string;
}

// 16px text: anything smaller and iOS zooms the page on focus.
const FIELD_TEXT = 'min-h-touch text-base text-gray-900';

const BORDER = {
  base: 'border-muted-300 focus:border-primary focus:ring-primary-200',
  error: 'border-danger focus:border-danger focus:ring-danger-200',
  // The prefixed field draws its border on the wrapper, so the ring has to
  // follow focus landing on the input inside it.
  groupBase: 'border-muted-300 focus-within:border-primary focus-within:ring-primary-200',
  groupError: 'border-danger focus-within:border-danger focus-within:ring-danger-200',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, id, className, 'aria-describedby': describedByProp, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const prefixId = `${inputId}-prefix`;
  const describedBy =
    cx(describedByProp, prefix !== undefined && prefixId, hint && hintId, error && errorId) ||
    undefined;

  const shared = {
    ...rest,
    ref,
    id: inputId,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
  };

  const field: ReactElement =
    prefix === undefined ? (
      <input
        {...shared}
        className={cx(
          'block w-full rounded-lg border bg-white px-3 transition-colors',
          FIELD_TEXT,
          'placeholder:text-muted focus:outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:bg-muted-100 disabled:text-muted',
          error ? BORDER.error : BORDER.base,
          className,
        )}
      />
    ) : (
      <div
        className={cx(
          'flex items-center rounded-lg border bg-white transition-colors focus-within:ring-2',
          FIELD_TEXT,
          'has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted-100',
          error ? BORDER.groupError : BORDER.groupBase,
        )}
      >
        <span id={prefixId} className="select-none pl-3 pr-1.5 text-muted-700">
          {prefix}
        </span>
        <input
          {...shared}
          className={cx(
            'block w-full rounded-r-lg bg-transparent pr-3',
            FIELD_TEXT,
            'placeholder:text-muted focus:outline-none',
            'disabled:cursor-not-allowed disabled:text-muted',
            className,
          )}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-900">
        {label}
      </label>
      {field}
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        // `alert`, so a message that appears on submit -- while focus is still
        // on the button -- is announced rather than silently added below.
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
});
