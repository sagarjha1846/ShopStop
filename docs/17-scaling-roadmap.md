# 17 — Scaling Roadmap (100 → 1M users)

The architecture is designed so the **first 100K users need no re-architecture** — just bigger boxes and a couple of managed services. Beyond that, the module seams ([07](07-backend-architecture.md)) let us extract services one bottleneck at a time. Scale when a **metric** forces it, never speculatively.

## Stage 1 — 100 users (validate)
- **Infra:** single VPS, Docker Compose (api+web+worker+postgres+redis). Postgres FTS search.
- **Focus:** liquidity + trust loop working end-to-end; instrument everything.
- **Bottleneck:** none technical — it's product/market fit.
- **Cost:** ~$25–45/mo ([16](16-cost-estimation.md)).

## Stage 2 — 1,000 users
- **Infra:** same box, slightly larger; enable caching for hot reads (categories, listing detail); tune Postgres.
- **Add:** proper backups + PITR, uptime + error monitoring, staging env.
- **Bottleneck:** occasional CPU spikes from image processing → ensure media scan/derivatives are on the worker queue, not the request path.

## Stage 3 — 10,000 users
- **Move DB off the app box:** managed Postgres (or dedicated VPS) — the single most important early split.
- **Redis:** small managed instance or dedicated.
- **App:** run 2 api replicas behind the proxy (Socket.IO uses the Redis adapter already, so realtime scales horizontally).
- **Media:** S3 + CloudFront tuned; image optimization/AVIF; signed URLs.
- **Search:** still Postgres FTS (fine here) — watch query latency.
- **Bottleneck:** DB connection pool + single-writer read load → add **read replica**, route reads.
- **Cost:** ~$80–150/mo.

## Stage 4 — 100,000 users (the design target — no re-architecture)
- **Compute:** 2–3 app instances + autoscaling **workers**, either bigger VPSes behind a load balancer or migrate to **ECS Fargate** (same images).
- **DB:** managed Postgres, multi-AZ, **read replica(s)**; introduce **table partitioning** for hot append-heavy tables (`messages`, `audit_logs`, `fraud_events`, `notifications`) by time.
- **Search:** move to **OpenSearch/Elasticsearch** when FTS relevance/latency caps out (search adapter interface makes this a swap, not a rewrite).
- **Cache:** managed Redis; cache hot listing/profile/category reads aggressively; consider CDN caching of SSR public pages.
- **Realtime:** dedicated Socket.IO instances if chat/presence load warrants.
- **Trust engine:** introduce ML fraud scoring + image-similarity dedupe (rules stay as guardrails + labels).
- **Bottleneck:** write throughput on `orders/payments`, search cluster sizing, media egress.
- **Cost:** ~$400–900/mo. **Cost/MAU < $0.01.**

## Stage 5 — 1,000,000 users
- **Extract services along existing seams** (only the ones that hurt): search, media processing, notifications, messaging/realtime, payments/ledger. Communication via a real event bus (Redis Streams/SQS/Kafka) — the in-process domain events become network events with no domain-logic change.
- **Orchestration:** ECS (or EKS if the team is ready); autoscaling per service.
- **DB:** partitioning + read replicas; **shard or split by domain** (e.g., messaging store separate) if a single primary can't take writes; consider CQRS/read models for feeds.
- **Search:** OpenSearch cluster; async indexing pipeline.
- **Media:** CDN at volume; possibly R2/multi-CDN to control egress.
- **Data platform:** stream events to a warehouse (BigQuery/ClickHouse) for analytics/BI ([03](03-features.md) analytics), keeping OLTP lean.
- **Resilience:** multi-AZ everywhere, WAF/DDoS (Cloudflare), rate-limit at edge, chaos/DR drills.
- **Bottleneck:** now organizational + per-service; solvable independently thanks to the seams.
- **Cost:** ~$3k–8k+/mo (revenue should dominate infra by here).

## What stays constant across all stages
- **Contracts** (REST + Socket.IO + Zod) — clients and the future RN app never break.
- **Domain events** as the integration seam — the monolith→services path is incremental.
- **Money in minor units + idempotency + immutable ledger** — correctness invariants don't change with scale.
- **Trust layer as the core** — it just gets more data and more accurate.

## The rule
> Add complexity (managed service, replica, extracted service, OpenSearch, Kubernetes) **only when a specific metric crosses a threshold** — DB CPU, p95 latency, queue depth, search latency, egress cost. Premature scaling is the most expensive mistake a budget-constrained marketplace can make.
