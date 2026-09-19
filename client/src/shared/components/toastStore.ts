import { create } from 'zustand';

/**
 * The one short message the app is currently showing.
 *
 * A store rather than a context, and callable from outside React, because the
 * things that need to speak here are not components: a mutation hook rolling
 * an optimistic update back, and — from Week 6 — the offline sync engine
 * reporting what it could not replay. Neither is in a position to be handed a
 * setter through props.
 *
 * **One at a time, and the newest wins.** A farmer who taps three rows on a
 * dead connection should be told once that the connection is dead, not given a
 * stack of three identical notices to dismiss. Each message carries an `id` so
 * that the same words shown twice still restart the timer and still reach a
 * screen reader as a new announcement.
 */

export type ToastTone = 'error' | 'info';

export interface Toast {
  /** Monotonic, so a repeat of the same words is still a new toast. */
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  current: Toast | null;
  show: (message: string, tone?: ToastTone) => void;
  /** Called by the viewport when the timer runs out or the farmer dismisses it. */
  dismiss: (id: number) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  current: null,

  show: (message, tone = 'error') => {
    nextId += 1;
    set({ current: { id: nextId, message, tone } });
  },

  dismiss: (id) => {
    // Only if it is still the one on screen. A timer from a message that has
    // already been replaced must not close its replacement early.
    set((state) => (state.current?.id === id ? { current: null } : state));
  },
}));

/** Shows a message, from anywhere — including outside a component. */
export function showToast(message: string, tone: ToastTone = 'error'): void {
  useToastStore.getState().show(message, tone);
}
