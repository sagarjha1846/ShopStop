import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Converts every thrown error into the uniform envelope:
 *   { error: { code, message, details?, requestId } }
 * Never leaks stack traces or internal messages to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        code = (b.code as string) ?? this.codeFromStatus(status);
        message = (b.message as string) ?? message;
        // class-validator returns message as string[] — surface as details
        if (Array.isArray(b.message)) {
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = b.message;
        }
        details = details ?? b.details;
      } else {
        message = String(body);
        code = this.codeFromStatus(status);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, code, message } = this.mapPrisma(exception));
    }

    // 5xx are unexpected — log with the requestId so ops can correlate.
    if (status >= 500) {
      this.logger.error(
        { requestId, err: exception instanceof Error ? exception.stack : exception },
        `Unhandled error on ${req.method} ${req.url}`,
      );
    }

    res.status(status).json({ error: { code, message, details, requestId } });
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'VALIDATION_ERROR';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }

  private mapPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    code: string;
    message: string;
  } {
    switch (e.code) {
      case 'P2002':
        return { status: 409, code: 'CONFLICT', message: 'Resource already exists' };
      case 'P2025':
        return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
      default:
        return { status: 500, code: 'INTERNAL', message: 'Database error' };
    }
  }
}
