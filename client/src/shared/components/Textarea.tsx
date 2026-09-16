import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';

import { cx } from '@/shared/utils/cx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Required, for the same reason as on `Input`: a placeholder is not a label. */
  label: string;
  hint?: string;
  error?: string;
}

/**
 * A multi-line field, wired up exactly like {@link Input}.
 *
 * Separate from `Input` rather than a `multiline` flag on it: the two render
 * different elements with different attributes (`rows`, no `type`), and a
 * component that switches element type on a prop ends up with a union of props
 * that neither caller reads cleanly.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, className, rows = 3, 'aria-describedby': describedByProp, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = cx(describedByProp, hint && hintId, error && errorId) || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-gray-900">
        {label}
      </label>
      <textarea
        {...rest}
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          // 16px text, as on `Input`: anything smaller and iOS zooms on focus.
          'block w-full rounded-lg border bg-white px-3 py-2 text-base text-gray-900',
          'transition-colors placeholder:text-muted focus:outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:bg-muted-100 disabled:text-muted',
          error
            ? 'border-danger focus:border-danger focus:ring-danger-200'
            : 'border-muted-300 focus:border-primary focus:ring-primary-200',
          className,
        )}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
});
