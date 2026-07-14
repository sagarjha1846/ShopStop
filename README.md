# ShopStop — A Trust-First Universal Marketplace

> Buy and sell almost anything, legally — on a platform where **trust is the product**, not the listings.

ShopStop is a category-agnostic, peer-to-peer marketplace (think Amazon × eBay × OLX × Facebook Marketplace) built for modern users and optimized for **low infrastructure cost**. The platform never owns inventory. It is a **trusted facilitator** between buyers and sellers, differentiated by an identity + fraud + dispute **trust layer** that is hard to copy and compounds over time.

This repository currently contains the **complete design package** (PRD → architecture → security → cost → scaling). It is written to be executed by a small team on a limited budget, and to survive a VAPT (Vulnerability Assessment & Penetration Test).

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
| 05 | [Database Schema (ERD)](docs/05-database-schema.md) | Entity model + narrative; code in [`prisma/schema.prisma`](prisma/schema.prisma) |
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

## Status

This is the **design deliverable**. Application scaffolding (NestJS app, Next.js app, migrations, CI workflow) is the natural next step and can be generated from these documents — see [docs/03-features.md](docs/03-features.md) for the MVP cut line and [docs/13-devops-and-deployment.md](docs/13-devops-and-deployment.md) for the delivery pipeline.

## License / Legal

See [docs/01-prd.md](docs/01-prd.md#legal--compliance) for the legal & compliance posture (India DPDP Act, GDPR-awareness, prohibited-goods policy).
