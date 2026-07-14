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

## Phase 4 — Commerce  ✅ verified end-to-end (24/24 E2E)
- [x] Idempotency interceptor (Redis: fingerprint + in-flight lock + cache-before-emit)
- [x] Orders + actor-aware state machine + timeline + inventory (SOLD/restock)
- [x] Payments adapter (Razorpay) + intent + idempotent HMAC-verified webhook + ledger
- [x] Reviews (verified-purchase) + reputation recompute
- [x] Messaging (threads, messages, structured offers accept/decline/counter)
- [~] Socket.IO realtime gateway → deferred (REST verified; realtime is delivery layer)

## Phase 5 — Trust & safety  ✅ verified end-to-end (13/13 E2E)
- [x] Risk engine (rules) + FraudEvent gating publish (from Phase 3, exercised here)
- [x] Reports + moderation actions + prioritized queue (RBAC) + hash-chained audit log
- [x] Disputes (open party-only/state-gated, admin resolve → refund/audit)
- [x] Users public trust profile (score + badges, no PII) + follow
- [~] Trust-score recompute worker (BullMQ) → Phase 7; counters updated inline for now

## Phase 6 — Frontend (apps/web, Next.js)  ✅ core slice verified against live API
- [x] Next.js 15 App Router + Tailwind + design tokens (light/dark, no-FOUC) + UI primitives
- [x] API client (SSR direct / browser proxy) + client auth (login/register/refresh, in-mem token)
- [x] Home (SSR + revalidate), Search (live FTS), Listing detail (SSR + JSON-LD + trust panel)
- [x] Sell page (auth-gated, data-driven category attribute form → risk-checked publish)
- [~] Dashboards (buyer/seller), messages UI, admin console, profile page → next
- [x] Verified live: home/search/listing render 200 with seeded data; `next build` clean (8 routes)

## Phase 7 — Hardening & delivery
- [x] Test suites: 27 unit + 2 black-box E2E suites (37 API checks); CI runs them
- [~] Security scans in CI (dep audit present; CodeQL/Semgrep/Trivy/gitleaks → to add)
- [ ] Observability wiring (metrics, Sentry stub)
- [x] Deploy config: multi-stage Dockerfiles (api + web standalone), docker-compose.prod,
      Caddy edge (auto-HTTPS + security headers), runtime migrate-on-boot, .dockerignore
- [x] SessionStart hook (auto-provision Postgres/Redis/.env/deps/migrate/seed)

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
- S4: Commerce (messaging/orders/payments/reviews) + trust&safety (users/audit/moderation/
  disputes). Fixed a real idempotency bug (Reflect.metadata→SetMetadata) + a race
  (cache-before-emit) found by running it. NOTE: a container restart rolled the working tree
  back to S3's last push and wiped the uncommitted Phase 4/5 code + local DB + .env; recovered
  by recreating from context and re-provisioning. LESSON: commit after every green typecheck.
  Verified live: commerce 24/24, trust 13/13 E2E; 27 unit tests green. E2E scripts committed
  under apps/api/test/e2e. Next: Phase 6 frontend (apps/web) + Phase 7 hardening.
