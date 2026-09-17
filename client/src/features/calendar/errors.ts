import type { TFunction } from 'i18next';

import { getApiErrorCode } from '@/shared/api/client';

/**
 * What to tell a farmer when a calendar call fails.
 *
 * The same arrangement as `plots/errors.ts`, and for the same reason: one
 * entry point per action, because `CALENDAR_TASK_NOT_FOUND` means different
 * things depending on what was being attempted. Everything else collapses into
 * the per-action message — a farmer cannot act on the difference between a
 * timeout and a 502.
 */

/** For the list load, which holds a code in the store rather than a cause. */
export function listErrorMessage(code: string | null, t: TFunction): string {
  if (code === 'PLOT_NOT_FOUND') {
    return t('plot.error.gone', 'This plot is no longer there. It may have been deleted.');
  }
  return t('calendar.error.load', 'Your tasks could not be loaded. Check your connection.');
}

export function saveErrorMessage(cause: unknown, t: TFunction): string {
  switch (getApiErrorCode(cause)) {
    case 'CALENDAR_TASK_NOT_FOUND':
      // The id names a task deleted on another device. A deleted task's id
      // stays reserved, so this is final: the farmer has to add a new task
      // rather than retry this one.
      return t('calendar.error.gone', 'This task is no longer there. It may have been deleted.');
    case 'PLOT_NOT_FOUND':
      return t('plot.error.gone', 'This plot is no longer there. It may have been deleted.');
    case 'VALIDATION_ERROR':
      return t('calendar.error.validation', 'Check the details and try again.');
    default:
      return t('calendar.error.save', 'Could not save this task. Check your connection.');
  }
}

/** Completing and re-opening both go through here: one tap, one message. */
export function completeErrorMessage(cause: unknown, t: TFunction): string {
  if (getApiErrorCode(cause) === 'CALENDAR_TASK_NOT_FOUND') {
    return t('calendar.error.gone', 'This task is no longer there. It may have been deleted.');
  }
  return t('calendar.error.complete', 'Could not update this task. Check your connection.');
}

export function deleteErrorMessage(cause: unknown, t: TFunction): string {
  if (getApiErrorCode(cause) === 'CALENDAR_TASK_NOT_FOUND') {
    // Already gone, which is what was wanted. Said plainly rather than
    // reported as a failure.
    return t('calendar.error.gone', 'This task is no longer there. It may have been deleted.');
  }
  return t('calendar.error.delete', 'Could not delete this task. Check your connection.');
}
