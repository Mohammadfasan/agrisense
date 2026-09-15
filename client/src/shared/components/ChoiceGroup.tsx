import type { LucideIcon } from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { cx } from '@/shared/utils/cx';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Shown above the label. Decorative: the label carries the meaning. */
  icon?: LucideIcon;
}

interface SingleProps<T extends string> {
  multiple?: false;
  value: T | undefined;
  onChange: (value: T) => void;
}

interface MultiProps<T extends string> {
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
}

/** Spelt out rather than interpolated, so Tailwind's scanner sees them. */
const COLUMN_CLASS: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

export type ChoiceGroupProps<T extends string> = {
  /** The question. Rendered as the fieldset legend, so it is read once. */
  legend: string;
  hint?: string;
  error?: string;
  options: readonly ChoiceOption<T>[];
  /** Side by side from this many options up. Defaults to one per row. */
  columns?: 1 | 2 | 3;
} & (SingleProps<T> | MultiProps<T>);

/**
 * A tappable list of options, one question per group.
 *
 * Built on real radios and checkboxes rather than buttons with `aria-pressed`:
 * a fieldset of radios already announces "3 of 5", moves with arrow keys and
 * is understood by every screen reader, and none of that has to be rebuilt.
 * The inputs are visually replaced, not hidden from assistive tech -- the
 * label is the target, and it is the full width and height of the card, which
 * is what makes these comfortably larger than the 44px minimum.
 */
export function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>): ReactElement {
  const { legend, hint, error, options, columns = 1 } = props;
  const name = useId();
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = cx(hint && hintId, error && errorId) || undefined;

  const isSelected = (value: T): boolean =>
    props.multiple === true ? props.value.includes(value) : props.value === value;

  const toggle = (value: T): void => {
    if (props.multiple !== true) {
      props.onChange(value);
      return;
    }
    const selected = new Set(props.value);
    if (!selected.delete(value)) {
      selected.add(value);
    }
    // Emitted in catalogue order rather than tap order, so what the profile
    // screen reads back does not depend on how it was filled in.
    props.onChange(options.map((option) => option.value).filter((v) => selected.has(v)));
  };

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={describedBy}>
      <legend className="mb-1 text-sm font-medium text-gray-900">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}

      <div className={cx('grid gap-2', COLUMN_CLASS[columns])}>
        {options.map(({ value, label, icon: Icon }) => {
          const selected = isSelected(value);
          return (
            <label
              key={value}
              className={cx(
                'flex min-h-touch-lg cursor-pointer select-none items-center gap-3 rounded-xl border-2 p-3',
                'transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2',
                'has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
                Icon && 'flex-col justify-center text-center',
                selected
                  ? 'border-primary bg-primary-50 text-primary-700'
                  : 'border-muted-300 bg-white text-gray-900 hover:bg-muted-50',
              )}
            >
              <input
                // `sr-only` and not `hidden`: the control still has to be
                // focusable and announced, it just is not what you see.
                className="sr-only"
                type={props.multiple === true ? 'checkbox' : 'radio'}
                name={name}
                value={value}
                checked={selected}
                onChange={() => {
                  toggle(value);
                }}
                {...(error === undefined ? {} : { 'aria-invalid': true })}
              />
              {Icon && <Icon className="h-8 w-8 shrink-0" aria-hidden />}
              <span className={cx('text-base font-medium', Icon && 'text-sm')}>{label}</span>
            </label>
          );
        })}
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
