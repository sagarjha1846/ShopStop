# 07 — Backend Architecture

## Shape: a modular monolith
One **NestJS** application, one deployable, organized into **feature modules** with hard seams. This is the right cost/complexity trade for a small team at ≤100K users: a single process, single DB, no network hops or distributed-systems tax — but with module boundaries drawn so any module can be **extracted into a service later** without a rewrite (see [17](17-scaling-roadmap.md)).

> Rule: modules talk through **service interfaces and domain events**, never by reaching into each other's tables. That discipline is what makes future extraction cheap.

## Module map

```
apps/api (NestJS)
├── core/            config, logging, prisma, redis, security, health, audit
├── auth/            register/login/OTP/OAuth, JWT rotation, MFA, sessions, RBAC/ABAC guards
├── users/           profiles, follows, reputation counters
├── catalog/         categories (attribute schema), listings, variants, media
├── search/          Postgres FTS + trigram; adapter interface → OpenSearch later
├── messaging/       threads, messages, offers; Socket.IO gateway
├── orders/          order state machine, coupons
├── payments/        gateway adapters (Razorpay…), intents, webhooks, ledger
├── reviews/         verified-purchase reviews, reputation events
├── trust/           risk engine, trust score, fraud events   ← core differentiator
├── moderation/      reports, moderation actions, queues
├── notifications/   in-app + email (channel adapters)
├── admin/           admin/moderation/fraud/dispute APIs, feature flags
└── jobs/            BullMQ processors (fraud, media-scan, notify, reputation, search-index)
```

## Layering (per module)
`Controller (HTTP/DTO) → Service (domain logic) → Repository (Prisma) → DB`. Guards/interceptors handle auth, RBAC/ABAC, rate limiting, idempotency, request-id, and audit. DTOs validated with class-validator/Zod at the edge; domain layer never sees raw input.

## Cross-cutting infrastructure
- **Config:** typed env via `@nestjs/config` + Zod validation at boot (fail fast on missing secrets).
- **Persistence:** Prisma → PostgreSQL 16. Transactions for multi-row invariants (order+payment+ledger). Read-your-writes on the primary; add a read replica only when read load demands ([17](17-scaling-roadmap.md)).
- **Cache/coordination:** Redis — response cache for hot reads (categories, listing detail), session/refresh bookkeeping, rate-limit buckets, idempotency store, BullMQ backend, Socket.IO adapter (for multi-instance).
- **Realtime:** Socket.IO gateway, JWT-authenticated, Redis adapter so it scales horizontally.

## Async work (BullMQ)
Anything slow, retryable, or spiky runs off the request path:

| Queue | Triggered by | Work |
|---|---|---|
| `media-scan` | media upload | virus/NSFW/illegal-image scan, thumbnail/derivatives, set `scanStatus` |
| `risk` | login, listing publish, order, payment | run rule set → write `FraudEvent`, gate/hold subjects |
| `notify` | domain events | email + in-app + (P2) push/SMS via channel adapters |
| `reputation` | review/order events | recompute `Profile` counters + `TrustScore` |
| `search-index` | listing changes | (P2) push docs to OpenSearch |
| `payouts` (P2) | delivery confirmed | seller settlement / escrow release |

Jobs are **idempotent** and use exponential backoff + a dead-letter queue. Workers can run in-process (MVP, single VPS) or as a separate container/process (flip a flag) when CPU-bound work needs isolation.

## Domain events (the seam)
Services emit events (`listing.published`, `order.paid`, `message.sent`, `dispute.opened`). In the monolith these are an in-process event bus that also enqueues jobs; when a module is extracted, the same events become a real broker (Redis Streams/SQS) with no domain-logic change.

## Key flows (diagrams in [09](09-system-design-diagrams.md))
- **Auth:** password (Argon2id) / OTP / OAuth → issue access JWT + rotating refresh (hashed in `Session`); refresh rotation detects reuse (token theft) and revokes the family.
- **Listing publish:** validate attributes against category schema → create → enqueue `risk` + `media-scan` → `ACTIVE` / `PENDING_REVIEW` based on risk verdict.
- **Order + payment:** create order (idempotent) → `/payments/intent` at gateway → client pays → **webhook** (signature-verified, idempotent) → capture → `ledger` rows → order `ACCEPTED` → state machine to delivery → reviews → reputation recompute.
- **Fraud containment:** risk engine scores events; high scores auto-hold listings / rate-limit / raise prioritized admin alerts before victims are exposed.

## Payment adapter design
`PaymentProvider` interface (`createIntent`, `verifyWebhook`, `capture`, `refund`, `payout`) with a Razorpay implementation for MVP; Cashfree/PhonePe drop in behind the same interface (Phase 2). Money invariants live in the ledger, provider-agnostic.

## API/runtime concerns
- **Idempotency + rate limiting + audit** as interceptors/guards (see [06](06-api-spec.md), [11](11-security-architecture.md)).
- **Graceful shutdown:** drain HTTP, finish/re-queue in-flight jobs, close DB/Redis; Docker `stop_grace_period` respected.
- **Health:** `/health/live` (process) + `/health/ready` (DB/Redis/queue reachable) for the load balancer and CI smoke tests.

## Why not microservices / serverless now
Microservices add network failure modes, distributed tracing needs, and ops overhead a small team can't afford at this scale. Serverless (Lambda) struggles with Socket.IO, long-lived connections, and predictable cost under steady load. The modular monolith gives 90% of the benefit at 10% of the cost, and the module seams keep the exit door open.
