import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap, switchMap } from 'rxjs/operators';
import { createHash } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { AppError } from '../errors/app-error';
import type { AuthUser } from '../../modules/auth/types';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marks a mutating route as idempotent. Clients pass an `Idempotency-Key` header;
 * retries with the same key return the first response instead of re-executing —
 * essential for orders/payments where a network retry must not double-charge.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

interface CachedResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private static readonly TTL_SEC = 60 * 60 * 24; // 24h
  private static readonly LOCK_TTL_SEC = 30;

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isIdempotent) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const rawKey = req.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key) {
      throw AppError.validation('Idempotency-Key header is required for this operation');
    }

    // Scope by user + route + a hash of the body so a reused key on a *different*
    // request is rejected rather than silently returning the wrong cached response.
    const bodyHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex').slice(0, 16);
    const scope = `idem:${req.user?.id ?? 'anon'}:${req.method}:${req.route?.path ?? req.path}:${key}`;
    const resultKey = `${scope}:result`;
    const lockKey = `${scope}:lock`;
    const fingerprintKey = `${scope}:fp`;

    return from(this.resolve(resultKey, fingerprintKey, lockKey, bodyHash)).pipe(
      switchMap((cached) => {
        if (cached) {
          res.status(cached.status);
          return of(cached.body);
        }
        return next.handle().pipe(
          // Persist the response BEFORE emitting so a retry always sees the cached
          // result rather than racing the write (and releasing the in-flight lock).
          mergeMap(async (body) => {
            const payload: CachedResponse = { status: res.statusCode, body };
            await this.redis
              .setEx(resultKey, JSON.stringify(payload), IdempotencyInterceptor.TTL_SEC)
              .catch(() => undefined);
            await this.redis.del(lockKey).catch(() => undefined);
            return body;
          }),
          // On failure, don't cache and release the lock so the client can retry
          // immediately instead of waiting out the lock TTL.
          catchError((err) => {
            void this.redis.del(lockKey).catch(() => undefined);
            return throwError(() => err);
          }),
        );
      }),
    );
  }

  private async resolve(
    resultKey: string,
    fingerprintKey: string,
    lockKey: string,
    bodyHash: string,
  ): Promise<CachedResponse | null> {
    // Verify the body fingerprint FIRST: a key reused with a different body is a
    // client bug and must 409 even if we already have a cached response for it.
    const priorFp = await this.redis.get(fingerprintKey);
    if (priorFp && priorFp !== bodyHash) {
      throw AppError.conflict('Idempotency-Key reused with a different request body');
    }

    const existing = await this.redis.get(resultKey);
    if (existing) return JSON.parse(existing) as CachedResponse;

    if (!priorFp) {
      await this.redis.setEx(fingerprintKey, bodyHash, IdempotencyInterceptor.TTL_SEC);
    }

    // In-flight lock: a concurrent duplicate is told to retry rather than double-execute.
    const locked = await this.redis.client.set(
      lockKey,
      '1',
      'EX',
      IdempotencyInterceptor.LOCK_TTL_SEC,
      'NX',
    );
    if (locked === null) {
      throw new AppError('CONFLICT', 'A request with this Idempotency-Key is already in progress');
    }
    return null;
  }
}
