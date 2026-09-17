import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface BottomSheetProps {
  open: boolean;
  /** The sheet's accessible name, and its visible heading. */
  title: string;
  /** Called on Escape, on the close button, and on a tap outside the sheet. */
  onClose: () => void;
  /** Blocks closing while a save is in flight. */
  busy?: boolean;
  children: ReactNode;
}

/**
 * A panel that rises from the bottom of the screen, for a short task inside a
 * screen rather than a screen of its own.
 *
 * Why not a page. Adding a task to a calendar is a glance and four fields, and
 * a route change would cost the farmer the list they were reading, the scroll
 * position they were at, and a back tap to get both again. The sheet leaves
 * the calendar visible behind it, which is what makes "add the weeding two
 * days after the spraying" a single thought.
 *
 * Why the bottom. On a 360px phone held one-handed, the bottom third is the
 * only part of the screen a thumb reaches without shifting grip. The sheet
 * puts its fields and its save button there.
 *
 * Built on the native `<dialog>`, exactly like `ConfirmDialog`: focus moves in
 * and is trapped, the page behind goes inert, and Escape works — none of which
 * has to be rebuilt or got subtly wrong. The element is stretched to the
 * bottom edge with margin utilities rather than positioned, so the browser's
 * own top-layer handling still applies.
 */
export function BottomSheet({
  open,
  title,
  onClose,
  busy = false,
  children,
}: BottomSheetProps): ReactElement {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      onCancel={(event) => {
        // Escape. Routed through `onClose` instead, so the caller's `open`
        // follows the element rather than the element quietly closing
        // underneath a prop that still says it is open.
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      onClick={(event) => {
        // The backdrop is part of the dialog element, so a click that lands on
        // the element itself — rather than on anything inside it — is a click
        // outside the sheet.
        if (event.target === ref.current && !busy) {
          onClose();
        }
      }}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-lg rounded-t-2xl border border-muted-200 bg-white p-0 text-gray-900 shadow-lg backdrop:bg-gray-900/50 sm:mx-auto sm:mb-8 sm:rounded-2xl"
    >
      {/* The inner div is what scrolls, so the header stays put while a long
          form moves under it. */}
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex items-center gap-3 border-b border-muted-200 px-4 py-3">
          <h2 id={titleId} className="flex-1 text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex min-h-touch-md min-w-touch-md items-center justify-center rounded-full text-muted-700 hover:bg-muted-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:text-muted"
          >
            <X className="h-6 w-6" aria-hidden />
            <span className="sr-only">{t('common.close', 'Close')}</span>
          </button>
        </div>

        {/* The bottom padding clears the iOS home indicator; `index.html` sets
            viewport-fit=cover. */}
        <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
          {children}
        </div>
      </div>
    </dialog>
  );
}
