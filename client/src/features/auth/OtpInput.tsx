import { useId, useRef, type ClipboardEvent, type KeyboardEvent, type ReactElement } from 'react';

import { cx } from '@/shared/utils/cx';

export interface OtpInputProps {
  /** How many boxes, and the length at which `value` is complete. */
  length: number;
  /** Digits only, left-packed: box `i` is filled when `i < value.length`. */
  value: string;
  onChange: (value: string) => void;
  /** Names the group, not any one box. Screen readers read it before each digit. */
  label: string;
  /** Builds each box's accessible name, e.g. "Digit 3 of 6". */
  digitLabel: (index: number, total: number) => string;
  hint?: string;
  /** Shown below the boxes, which are all marked invalid while it is set. */
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

const BOX = [
  'min-h-touch w-full rounded-lg border bg-white text-center',
  // 16px minimum or iOS zooms the page on focus; the code is the whole screen,
  // so it gets more than that.
  'text-xl font-semibold tabular-nums text-gray-900',
  'transition-colors focus:outline-none focus:ring-2',
  'disabled:cursor-not-allowed disabled:bg-muted-100 disabled:text-muted',
].join(' ');

/**
 * The code field: `length` boxes that behave as one value.
 *
 * The boxes are separate inputs -- which is what makes a browser's SMS autofill
 * spread a code across them -- but the value behind them is a single string,
 * kept left-packed so there is no way to leave a gap in the middle and no
 * second source of truth about which box holds what. Every edit is therefore a
 * string operation, and focus follows the value's length rather than being
 * steered by hand.
 */
export function OtpInput({
  length,
  value,
  onChange,
  label,
  digitLabel,
  hint,
  error,
  disabled = false,
  autoFocus = false,
}: OtpInputProps): ReactElement {
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const hintId = `${groupId}-hint`;
  const errorId = `${groupId}-error`;
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const describedBy = cx(hint && hintId, error && errorId) || undefined;

  /** Applies an edit and puts the caret in the box the next digit belongs in. */
  const commit = (next: string, caret: number): void => {
    onChange(next);
    boxes.current[Math.min(Math.max(caret, 0), length - 1)]?.focus();
  };

  /**
   * Writes `digits` from `index` on.
   *
   * One digit is a correction and keeps whatever followed it, so a farmer who
   * mistyped the third of six fixes that box and leaves the rest standing. More
   * than one is a code arriving whole -- a paste, an autofill -- and replaces
   * the tail, because what was there was a different code.
   */
  const write = (index: number, digits: string): void => {
    const tail = digits.length === 1 ? value.slice(index + 1) : '';
    commit((value.slice(0, index) + digits + tail).slice(0, length), index + digits.length);
  };

  const handleChange = (index: number, raw: string): void => {
    const typed = raw.replace(/\D/g, '');
    const current = value[index] ?? '';
    // A box holds one digit, so anything longer is the browser's doing: an
    // autofill dropping the whole code in, or a keystroke landing after the
    // digit already there. Only what is new to the box gets written.
    const digits = current !== '' && typed.startsWith(current) ? typed.slice(1) : typed;
    if (digits === '') {
      // The box was emptied -- a delete, or a character that is not a digit and
      // so never took. Close the gap rather than leave a hole in the middle.
      commit(value.slice(0, index) + value.slice(index + 1), index);
      return;
    }
    write(index, digits);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      // Handled here rather than left to the browser, so that backspace in an
      // empty box clears the one before it instead of doing nothing.
      event.preventDefault();
      const target = value[index] === undefined ? index - 1 : index;
      if (target >= 0) {
        onChange(value.slice(0, target) + value.slice(target + 1));
        boxes.current[target]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>): void => {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '');
    if (digits === '') {
      return;
    }
    // Farmers paste the code out of the SMS, spaces and all, into whichever box
    // they happened to tap. Taking it here rather than through `onChange` means
    // the whole clipboard is available, not just what one box would keep.
    event.preventDefault();
    write(index, digits);
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium text-gray-900">
        {label}
      </span>
      <div
        // A group rather than a fieldset: these are one value split across
        // boxes, and the label above is the name of that value.
        role="group"
        aria-labelledby={labelId}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        className="flex gap-2"
      >
        {Array.from({ length }, (_, index) => (
          <input
            key={index}
            ref={(node) => {
              boxes.current[index] = node;
            }}
            value={value[index] ?? ''}
            onChange={(event) => {
              handleChange(index, event.target.value);
            }}
            onKeyDown={(event) => {
              handleKeyDown(index, event);
            }}
            onPaste={(event) => {
              handlePaste(index, event);
            }}
            onFocus={(event) => {
              // Tapping a box past the end of the code would otherwise put the
              // caret somewhere the next digit cannot land, because the value
              // stays packed: send it to the first empty box instead.
              const reachable = Math.min(index, value.length);
              if (reachable !== index) {
                boxes.current[reachable]?.focus();
                return;
              }
              // Selected, so a farmer correcting one digit overwrites it
              // instead of typing a second digit into the same box.
              event.target.select();
            }}
            type="text"
            // `numeric`, not `tel`: the box takes digits and nothing else, so
            // the plain number pad beats the phone keypad's * and #.
            inputMode="numeric"
            // Both halves of SMS autofill: the hint that the value is a code,
            // and -- on the first box, which is where a browser puts the whole
            // code -- the name it looks for.
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            aria-label={digitLabel(index + 1, length)}
            aria-invalid={error ? true : undefined}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            className={cx(
              BOX,
              error
                ? 'border-danger focus:border-danger focus:ring-danger-200'
                : 'border-muted-300 focus:border-primary focus:ring-primary-200',
            )}
          />
        ))}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        // `alert`, so a message that appears on submit -- while focus is still
        // on the button -- is announced rather than silently added below.
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
