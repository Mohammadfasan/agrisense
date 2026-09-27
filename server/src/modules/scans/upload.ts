import type { RequestHandler } from 'express';
import multer from 'multer';

import { env } from '@config';
import { AppError, ErrorCode, HttpStatus } from '@shared';

/**
 * Receives the single photo of a scan upload, into memory.
 *
 * Memory rather than disk: the service type-checks and hashes the bytes
 * before anything is stored, and `fileSize` caps what memory can hold.
 *
 * Mounted AFTER `authenticate` (see `scans.routes`), so an unauthenticated
 * client never gets its upload parsed at all.
 *
 * Multer's own errors are turned into `AppError`s here, so the client gets
 * the API's usual error shape and the right status instead of a 500.
 */
const parse = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.scans.maxBytes,
    files: 1,
    // The metadata fields are a UUID, a timestamp and two coordinates.
    fields: 8,
    fieldSize: 1024,
    parts: 10,
  },
}).single('photo');

export const receivePhoto: RequestHandler = (req, res, next) => {
  parse(req, res, (error: unknown) => {
    next(toAppError(error));
  });
};

function toAppError(error: unknown): unknown {
  // `undefined` means the upload was fine; anything that is not a multer
  // error goes to the error handler as it is.
  if (!(error instanceof multer.MulterError)) {
    return error;
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    const maxMb = Math.round(env.scans.maxBytes / (1024 * 1024));
    return new AppError(`The photo is larger than ${maxMb} MB`, HttpStatus.PAYLOAD_TOO_LARGE, {
      code: ErrorCode.SCAN_PHOTO_TOO_LARGE,
    });
  }
  // A wrong field name, a second file, too many fields...
  return AppError.validation('Invalid scan upload', [
    { path: error.field ?? 'photo', message: error.message },
  ]);
}
