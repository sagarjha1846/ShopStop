import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics (docs/14). Default Node/process metrics + RED signals
 * (request rate, errors, duration) per route. Scraped at GET /metrics.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;
  readonly httpErrors: Counter<string>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'shopstop-api' });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.httpErrors = new Counter({
      name: 'http_requests_errors_total',
      help: 'Total HTTP responses with status >= 500',
      labelNames: ['method', 'route'],
      registers: [this.registry],
    });
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    this.httpDuration.labels(method, route, String(status)).observe(seconds);
    if (status >= 500) this.httpErrors.labels(method, route).inc();
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
