import { isAxiosError } from 'axios';

import { SCAN_ERRORS } from '@/api/scans';
import { getApiErrorCode } from '@/shared/api/client';

export type UploadFailure = 'offline' | 'server' | 'invalid' | 'tooLarge' | 'plotMissing';

export function classifyUploadError(error: unknown): UploadFailure {
  const code = getApiErrorCode(error);
  if (code === SCAN_ERRORS.imageInvalid) {
    return 'invalid';
  }
  if (code === SCAN_ERRORS.tooLarge) {
    return 'tooLarge';
  }
  if (code === SCAN_ERRORS.plotNotFound) {
    return 'plotMissing';
  }
  // No response at all: no signal, a dropped connection, or our own timeout.
  if ((isAxiosError(error) && error.response === undefined) || !navigator.onLine) {
    return 'offline';
  }
  return 'server';
}

export function canRetrySamePhoto(failure: UploadFailure): boolean {
  return failure === 'offline' || failure === 'server';
}
