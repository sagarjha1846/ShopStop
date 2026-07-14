# 14 — Monitoring, Logging & Observability

Target: **99.9% uptime**, fast MTTR, SIEM-ready security telemetry — on a small budget (open-source first).

## Three pillars
| Pillar | MVP (cheap/OSS) | Scale-up |
|---|---|---|
| **Metrics** | Prometheus + Grafana (self-hosted) | Managed Grafana Cloud / Datadog |
| **Logs** | Structured JSON → Loki (or Grafana Cloud free tier) | ELK/OpenSearch, cold storage |
| **Traces** | OpenTelemetry SDK → Tempo/Jaeger | Managed tracing |
| **Errors** | Sentry (self-host or free tier) | Sentry team plan |
| **Uptime** | UptimeRobot / Better Uptime free | Pingdom |

All instrumented via **OpenTelemetry** so backends are swappable without code changes.

## Structured logging
- JSON logs (pino) with `requestId`, `userId` (when safe), route, latency, status. **PII scrubbed** (no emails/phones/tokens/card data in logs).
- Correlation: `requestId` generated at the edge, propagated through services, jobs, and returned to clients in error envelopes ([06](06-api-spec.md)).
- Log levels disciplined; no stack traces to clients; sampled debug in prod.

## Metrics that matter
- **RED per endpoint:** Rate, Errors, Duration (p50/p95/p99).
- **USE for infra:** Utilization/Saturation/Errors for CPU, memory, DB connections, Redis, disk.
- **Queues:** BullMQ depth, wait time, failure rate, DLQ size per queue.
- **DB:** slow queries, connection pool saturation, replication lag (when replica added), cache hit ratio.
- **Business/trust:** signups, listings created, orders, payment success rate, dispute rate, fraud events by band, median time-to-takedown.

## Tracing
- OTel spans across HTTP → service → Prisma → Redis → jobs → payment gateway calls, so a slow checkout is traceable end-to-end.

## Health checks
- `/health/live` (process up) and `/health/ready` (Postgres, Redis, queue reachable) — used by proxy, deploy smoke tests, and uptime monitors.

## Alerting (actionable only — fight fatigue)
| Alert | Condition | Route |
|---|---|---|
| API error spike | 5xx rate > 2% for 5m | on-call page |
| Latency | p95 > 1s for 10m | on-call |
| Payment failures | success rate < 95% for 10m | page (revenue-critical) |
| Queue backlog | depth > threshold / DLQ growing | page |
| DB saturation | connections > 80% / disk > 80% | page |
| Fraud burst | high-band `FraudEvent` rate spike | trust & safety |
| Uptime | health check down | page |
| Cert expiry | < 14 days | ticket |

## Security monitoring / SIEM-ready
- Security events (login, MFA, privilege change, moderation action, payment, refund, admin access) emitted as structured events **and** written to the hash-chained `AuditLog` ([11](11-security-architecture.md)).
- Exportable to a SIEM (self-hosted Wazuh/OpenSearch, or managed) for correlation + retention. Anomaly alerts: impossible travel, admin action bursts, mass takedowns, credential-stuffing patterns.

## Dashboards
- **Ops:** RED/USE, queues, DB/Redis, deploy markers.
- **Product/Trust:** funnel, orders, payment success, dispute rate, fraud bands, takedown SLA.
- **Cost:** infra spend vs. MAU ([16](16-cost-estimation.md)).

## SLOs
- API availability **99.9%**; checkout success **≥ 99%** of valid attempts; p95 read latency **< 300ms**; error budget tracked, releases slow when budget burns.
