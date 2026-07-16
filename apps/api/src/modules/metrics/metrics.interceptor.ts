import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

/** Times every request and records RED metrics, labeled by the route pattern
 *  (not the raw URL) to keep cardinality bounded. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { route?: { path?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const route = req.route?.path ?? req.path ?? 'unknown';
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        this.metrics.observe(req.method, route, res.statusCode, seconds);
      }),
    );
  }
}
