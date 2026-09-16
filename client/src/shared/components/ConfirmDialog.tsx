import { useEffect, useId, useRef, type ReactElement } from 'react';

import { Button, type ButtonVariant } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, as a question. Rendered as the dialog's accessible name. */
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for a destructive confirm, which is most of them. */
  confirmVariant?: ButtonVariant;
  /** Spins the confirm button and blocks a second tap while the work runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no question the user has to answer before something irreversible
 * happens.
 *
 * Built on the native `<dialog>` element, so focus moves into it and is
 * trapped there, the rest of the page is inert, and Escape closes it -- all of
 * which would otherwise have to be rebuilt by hand and got subtly wrong. Note
 * this is the HTML element, not `window.confirm`: that one blocks the whole
 * renderer and cannot be styled or translated.
 *
 * Cancel comes first in the DOM, so `showModal()` puts the initial focus on
 * the safe answer rather than the destructive one.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = `${titleId}-description`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    // `dialog.open` is the element's own state, which Escape can change
    // without React knowing. Compare against it rather than tracking what was
    // last rendered, so the two cannot drift.
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        // Escape. Prevented and routed through `onCancel` instead, so the
        // caller's `open` follows the element rather than the element quietly
        // closing underneath a prop that still says it is open.
        event.preventDefault();
        if (!busy) {
          onCancel();
        }
      }}
      className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-muted-200 bg-white p-5 text-gray-900 shadow-lg backdrop:bg-gray-900/50"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className="text-sm text-muted-700">
              {description}
            </p>
          )}
        </div>

        {/* Full-width halves: either answer is a comfortable thumb target on a
            360px screen, and neither is the small one. */}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} className="flex-1" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
