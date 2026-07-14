# ShopStop — Build Progress

Living checklist for the long-running build. Updated every working session. `[x]` done · `[~]` in progress · `[ ]` todo.
Design package (docs/) is complete; this tracks **implementation**.

## Phase 0 — Foundations (repo, tooling, infra)
- [x] Design package (docs 01–18, Prisma ERD, OpenAPI)
- [x] Monorepo scaffold (pnpm workspaces, root tooling)
- [x] Shared config: tsconfig base, eslint (flat, typescript-eslint), prettier, .gitignore, .editorconfig
- [x] docker-compose (postgres, redis, mailhog, minio) + .env.example
- [x] CI workflow (GitHub Actions): typecheck, lint, test, build, dep-audit

## Phase 1 — Backend core (apps/api, NestJS)  ✅ running & verified
- [x] NestJS app skeleton + config module (Zod-validated env, fail-fast)
- [x] Prisma integration (schema in apps/api, client, init + FTS migrations, seed: category tree)
- [x] Health module (/health/live, /health/ready — DB+Redis checks)
- [x] Logging (pino) + requestId + global error filter + uniform error envelope (verified 422/409/401)
- [x] Redis module + global rate limiting (@nestjs/throttler)
- [~] Idempotency interceptor (deferred to Phase 4 — needed for orders/payments)
- [x] Security middleware (helmet headers, CORS w/ credentials, validation whitelist)

## Phase 2 — Auth & identity  ✅ verified end-to-end
- [x] Register/login (Argon2id), email verify token (Redis), phone OTP (dev-log provider)
- [x] JWT access + rotating refresh (hashed sessions, **reuse detection verified** — jti nonce fix)
- [x] RBAC guard + roles decorator + current-user decorator (ABAC ownership → in services, Phase 3+)
- [~] MFA (TOTP) verify-on-login done; enrollment endpoint + Google OAuth pending
- [x] Auth unit tests (password + token/rotation); integration/e2e pending Phase 7

## Phase 3 — Catalog & listings  ✅ verified end-to-end
- [x] Categories (data-driven attribute schema) endpoint + cached tree
- [x] Listings CRUD + seller state machine + **attribute validation vs category schema**
- [x] Risk-gated publish (ACTIVE vs PENDING_REVIEW) via rules risk engine + FraudEvent
- [x] ABAC ownership on update/pause/delete (verified 403 for non-owner)
- [x] Media signed-upload URL (presigned S3/MinIO) + content-type/size limits
- [x] Search (Postgres FTS ranked) + filters (price/category/condition/verified/rating) + ILIKE autocomplete
- [~] Async media-scan worker → Phase 4 (BullMQ); variants CRUD → later

## Phase 4 — Commerce
- [ ] Orders + state machine + timeline
- [ ] Payments adapter (Razorpay) + intent + idempotent webhook + ledger
- [ ] Reviews (verified-purchase)
- [ ] Messaging (threads, messages, offers) + Socket.IO gateway

## Phase 5 — Trust & safety
- [ ] Risk engine (rules) + FraudEvent + trust score worker
- [ ] Reports + moderation actions + queue + hash-chained audit log
- [ ] Disputes

## Phase 6 — Frontend (apps/web, Next.js)
- [ ] Next.js scaffold + Tailwind + design tokens (light/dark) + shadcn base
- [ ] API client + auth flow (silent refresh) + query client
- [ ] Home / search / listing / profile (SSR, SEO)
- [ ] Sell wizard, dashboards (buyer/seller), messages, admin console

## Phase 7 — Hardening & delivery
- [ ] Test suites (unit/integration/e2e) + coverage gate
- [ ] Security scans in CI (CodeQL/Semgrep, deps, Trivy, secret scan)
- [ ] Observability wiring (metrics, Sentry stub)
- [ ] Deploy config (compose.prod, runbooks)

---
### Session log
- S1: Design package (docs + Prisma + OpenAPI) committed & pushed.
- S2: Monorepo scaffold; NestJS core (config/prisma/redis/health/logging/errors/security);
  auth (register/login/OTP/refresh-rotation) built & **verified against live Postgres+Redis**.
  Fixed a real reuse-detection bug (identical rotated tokens → added jti nonce). CI + eslint added.
  9 unit tests green. Next: catalog (categories + listings + attribute validation).
- S3: Catalog module — categories (attribute schemas), listings (CRUD + state machine +
  attribute validation + ABAC), rules risk engine gating publish, media presigned uploads,
  Postgres FTS search + filters + autocomplete. Verified live: attribute 422, risk hold of
  unverified/high-value + prohibited-keyword listings, ABAC 403s, FTS + autocomplete hits.
  Fixed 2 real SQL bugs (deleted_at column, DISTINCT/ORDER BY). 16 unit tests green.
  Next: Phase 4 commerce — orders + payments (Razorpay, idempotent webhook) + messaging.
