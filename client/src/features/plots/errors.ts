import type { TFunction } from 'i18next';

import { getApiErrorCode } from '@/shared/api/client';

/**
 * What to tell a farmer when a plot call fails.
 *
 * Three entry points rather than one table, because the same `PLOT_NOT_FOUND`
 * means different things depending on what was being attempted: opening a plot
 * that is not there is an explanation, while saving one that is not there is a
 * loss the farmer has to be told about in those words.
 *
 * Everything else collapses into the per-action message. A farmer cannot act
 * on the difference between a timeout and a 502, and both are answered the
 * same way: check the connection and try again.
 */

/** For the list load, which holds a code in the store rather than a cause. */
export function listErrorMessage(code: string | null, t: TFunction): string {
  if (code === 'VALIDATION_ERROR') {
    // A cursor this server did not issue, most likely. Reloading drops it.
    return t('plot.error.validation', 'Check the details and try again.');
  }
  return t('plot.error.load', 'Your plots could not be loaded. Check your connection.');
}

export function saveErrorMessage(cause: unknown, t: TFunction): string {
  switch (getApiErrorCode(cause)) {
    case 'PLOT_NOT_FOUND':
      // The id is another farmer's, or names a plot deleted on another
      // device. A deleted plot's id stays reserved, so this is final: the
      // farmer has to make a new plot rather than retry this one.
      return t('plot.error.gone', 'This plot is no longer there. It may have been deleted.');
    case 'VALIDATION_ERROR':
      return t('plot.error.validation', 'Check the details and try again.');
    default:
      return t('plot.error.save', 'Could not save this plot. Check your connection.');
  }
}

export function deleteErrorMessage(cause: unknown, t: TFunction): string {
  if (getApiErrorCode(cause) === 'PLOT_NOT_FOUND') {
    // Already gone, which is what was wanted. Said plainly rather than
    // reported as a failure.
    return t('plot.error.gone', 'This plot is no longer there. It may have been deleted.');
  }
  return t('plot.error.delete', 'Could not delete this plot. Check your connection.');
}
