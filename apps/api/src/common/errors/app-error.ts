import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain error codes surfaced to clients in the uniform error envelope.
 * Keep messages non-sensitive (no stack traces, no PII).
 */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ILLEGAL_STATE'
  | 'RATE_LIMITED'
  | 'PAYMENT_ERROR'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<AppErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  ILLEGAL_STATE: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PAYMENT_ERROR: HttpStatus.BAD_GATEWAY,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class AppError extends HttpException {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, STATUS_BY_CODE[code]);
  }

  static notFound(what = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }

  static illegalState(message: string): AppError {
    return new AppError('ILLEGAL_STATE', message);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }
}
