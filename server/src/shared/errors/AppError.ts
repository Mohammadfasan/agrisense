import { HttpStatus, type HttpStatusCode } from '../http/statusCodes';

/** Machine-readable error codes returned to clients in `error.code`. */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppErrorOptions {
  /** Machine-readable code for clients to branch on. */
  code?: ErrorCodeValue;
  /** Safe, structured context included in the response body. */
  details?: unknown;
  /** Underlying error, kept for logs only — never serialised to the client. */
  cause?: unknown;
  /**
   * `true` for errors we anticipated and handled. `false` marks a defect: the
   * error handler logs those at `error` level and hides the message in prod.
   */
  isOperational?: boolean;
}

/**
 * An error carrying the HTTP status and client-facing shape it should produce.
 *
 * Throw these from anywhere in a request; `errorHandler` turns them into the
 * response. Anything that is *not* an AppError is treated as a bug.
 */
export class AppError extends Error {
  public readonly statusCode: HttpStatusCode;
  public readonly code: ErrorCodeValue;
  public readonly details: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: HttpStatusCode, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = options.code ?? codeForStatus(statusCode);
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;

    Error.captureStackTrace(this, new.target);
  }

  static badRequest(message = 'Bad request', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.BAD_REQUEST, options);
  }

  static validation(message = 'Validation failed', details?: unknown): AppError {
    return new AppError(message, HttpStatus.UNPROCESSABLE_ENTITY, {
      code: ErrorCode.VALIDATION_ERROR,
      details,
    });
  }

  static unauthorized(message = 'Authentication required', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.UNAUTHORIZED, options);
  }

  static forbidden(message = 'Insufficient permissions', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.FORBIDDEN, options);
  }

  static notFound(message = 'Resource not found', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.NOT_FOUND, options);
  }

  static conflict(message = 'Resource conflict', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.CONFLICT, options);
  }

  static tooManyRequests(message = 'Too many requests', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.TOO_MANY_REQUESTS, options);
  }

  static internal(message = 'Internal server error', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.INTERNAL_SERVER_ERROR, {
      isOperational: false,
      ...options,
    });
  }

  static serviceUnavailable(message = 'Service unavailable', options?: AppErrorOptions): AppError {
    return new AppError(message, HttpStatus.SERVICE_UNAVAILABLE, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function codeForStatus(statusCode: HttpStatusCode): ErrorCodeValue {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.TOO_MANY_REQUESTS;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}
