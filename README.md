# ShopStop — A Trust-First Universal Marketplace

> Buy and sell almost anything, legally — on a platform where **trust is the product**, not the listings.

ShopStop is a category-agnostic, peer-to-peer marketplace (think Amazon × eBay × OLX × Facebook Marketplace) built for modern users and optimized for **low infrastructure cost**. The platform never owns inventory. It is a **trusted facilitator** between buyers and sellers, differentiated by an identity + fraud + dispute **trust layer** that is hard to copy and compounds over time.

This repository contains **both the complete design package** (PRD → architecture → security → cost → scaling) **and a working implementation**: a NestJS modular-monolith API and a Next.js web app, verified end-to-end against live Postgres + Redis. It is written to be executed by a small team on a limited budget, and to survive a VAPT (Vulnerability Assessment & Penetration Test).

## Running locally

```bash
pnpm install
# In web sessions the SessionStart hook provisions Postgres/Redis/.env/migrate/seed.
# Otherwise: start Postgres + Redis, then:
cp .env.example .env
pnpm --filter @shopstop/api db:migrate:deploy && pnpm --filter @shopstop/api db:seed
pnpm --filter @shopstop/api dev      # API on :4000  (docs at /api/docs)
pnpm --filter @shopstop/web dev      # Web on :3000
```

Demo admin seeded in dev: `admin@shopstop.local` / `AdminPass123!`. Black-box flow
tests live in [`apps/api/test/e2e`](apps/api/test/e2e).

## What's built (MVP, verified)

- **Auth**: email/password (Argon2id), phone OTP, JWT access + rotating refresh with
  reuse detection, RBAC + ABAC, MFA-at-login.
- **Catalog**: data-driven categories (per-category attribute schemas), listings with
  attribute validation + seller state machine, Postgres FTS search + autocomplete,
  presigned media uploads.
- **Commerce**: buyer↔seller chat with structured offers, orders with an actor-aware
  state machine + inventory, Razorpay payments (idempotent HMAC-verified webhook →
  ledger → fulfilment), verified-purchase reviews.
- **Trust & safety** (the differentiator): rules risk engine gating publish, prioritized
  moderation + fraud queue, hash-chained tamper-evident audit log, disputes, public
  trust profiles.
- **Web**: home / search / listing / profile (SSR + SEO), auth, sell wizard, dashboard —
  light/dark, responsive.

See [PROGRESS.md](PROGRESS.md) for the live build checklist.

## Deploy

Every push builds the API and web images and publishes them to GitHub Container
Registry ([`.github/workflows/release.yml`](.github/workflows/release.yml)) — no
registry secrets needed, it uses the workflow's own token.

**From the published images** (no source tree required):

```bash
export IMAGE_OWNER=sagarjha1846      # lowercase
export IMAGE_TAG=latest              # or a branch, v-tag, or sha-<commit>
cp .env.example .env.deploy          # then fill in real secrets
docker compose -f docker-compose.deploy.yml --env-file .env.deploy up -d
```

You supply two things: a **Postgres** instance (`DATABASE_URL` — the API runs its
migrations on boot) and a **domain** in [`ops/Caddyfile`](ops/) for auto-HTTPS.
Redis and the Caddy edge come up with the stack. Per [docs/16](docs/16-cost-estimation.md)
this runs on a ~$25/mo VPS at launch scale.

**From source** instead: `docker compose -f docker-compose.prod.yml up -d --build`.

> **Before taking real payments**, read the monetization analysis — the current
> money flow captures funds into the platform's own gateway account with no
> settlement path to sellers, which is both a growing payable and a regulatory
> problem. Fix that first ([docs/18](docs/18-risks-and-tradeoffs.md) R4).

---

## Why this exists (the one-line thesis)

> A peer-to-peer marketplace where **every transaction is backed by identity verification, fraud detection, transparent communication, dispute resolution, and portable trust scores**. If users don't trust us more than OLX or Facebook Marketplace, they have no reason to switch. So we sell **trust**, not listings.

---

## Documentation index

| # | Document | What's inside |
|---|----------|---------------|
| 01 | [Product Requirements (PRD)](docs/01-prd.md) | Vision, goals, non-goals, success metrics, scope |
| 02 | [Personas & User Journeys](docs/02-personas-and-journeys.md) | 6 personas, end-to-end journeys |
| 03 | [Feature List (MVP / Phase 2 / Future)](docs/03-features.md) | Every feature, phased and prioritized |
| 04 | [Information Architecture & Wireframes](docs/04-ia-and-wireframes.md) | Sitemap, navigation, textual wireframes, design system |
| 05 | [Database Schema (ERD)](docs/05-database-schema.md) | Entity model + narrative; code in [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) |
| 06 | [API Specification](docs/06-api-spec.md) | REST conventions, endpoints; contract in [`api/openapi.yaml`](api/openapi.yaml) |
| 07 | [Backend Architecture](docs/07-backend-architecture.md) | NestJS modular monolith, queues, realtime |
| 08 | [Frontend Architecture](docs/08-frontend-architecture.md) | Next.js App Router, state, performance |
| 09 | [System Design Diagrams](docs/09-system-design-diagrams.md) | 10 Mermaid diagrams (auth, listing, payment, fraud…) |
| 10 | [Trust, Anti-Fraud & Moderation](docs/10-trust-and-antifraud.md) | The differentiator: risk engine, trust score, disputes |
| 11 | [Security Architecture](docs/11-security-architecture.md) | OWASP Top 10, auth, secrets, data protection |
| 12 | [VAPT Checklist](docs/12-vapt-checklist.md) | Pre-pentest hardening checklist |
| 13 | [DevOps & Deployment](docs/13-devops-and-deployment.md) | Docker Compose, GitHub Actions, VPS → ECS |
| 14 | [Monitoring & Logging](docs/14-monitoring-and-logging.md) | Metrics, logs, traces, alerting, SIEM-ready |
| 15 | [Testing Strategy](docs/15-testing-strategy.md) | Unit, integration, E2E, performance, security |
| 16 | [Cost Estimation](docs/16-cost-estimation.md) | Dev cost + monthly infra by scale tier |
| 17 | [Scaling Roadmap](docs/17-scaling-roadmap.md) | 100 → 1K → 10K → 100K → 1M users |
| 18 | [Risks, Trade-offs & Mitigations](docs/18-risks-and-tradeoffs.md) | Honest risk register |

**Start here:** [PRD](docs/01-prd.md) → [Features](docs/03-features.md) → [Trust layer](docs/10-trust-and-antifraud.md) → [Cost](docs/16-cost-estimation.md).

---

## Target architecture at a glance

```
Next.js (Vercel/Edge)  ──►  NestJS modular monolith (single VPS, Docker Compose)
        │                          │
        │                          ├── PostgreSQL 16   (primary datastore + FTS search)
        │                          ├── Redis           (cache, sessions, rate-limit, BullMQ)
        │                          ├── BullMQ workers   (fraud, notifications, media, moderation)
        │                          └── Socket.IO        (chat, presence, notifications)
        ▼
   S3 + CloudFront (media, signed uploads/downloads)
```

**Design rule:** one modular monolith that scales to ~100K users **without re-architecture**. Module boundaries are drawn so any module can later be extracted into a service. No Kubernetes until we're forced into it.

## Tech stack (chosen for cost + maintainability)

- **Frontend:** Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · TanStack Query
- **Backend:** NestJS · TypeScript · Prisma · class-validator · Zod contracts
- **Data:** PostgreSQL 16 (Postgres FTS for search v1) · Redis 7
- **Async/Realtime:** BullMQ · Socket.IO
- **Storage/CDN:** S3-compatible object storage · CloudFront
- **Payments (India-first):** Razorpay / Cashfree / PhonePe (webhook-driven, idempotent)
- **Infra:** Docker Compose on a single VPS/Lightsail/DigitalOcean → ECS later
- **CI/CD:** GitHub Actions

Full rationale, monthly costs, and scaling points: [docs/16-cost-estimation.md](docs/16-cost-estimation.md).

## Repository layout

```
apps/api        NestJS modular monolith (auth, catalog, commerce, trust & safety)
apps/web        Next.js App Router web app
docs/           the 18-part design package (01–18)
api/openapi.yaml  REST contract
.github/        CI workflow
.claude/        SessionStart hook (auto-provisions the dev environment)
```

## License / Legal

See [docs/01-prd.md](docs/01-prd.md#legal--compliance) for the legal & compliance posture (India DPDP Act, GDPR-awareness, prohibited-goods policy).
