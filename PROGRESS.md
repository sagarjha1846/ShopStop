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
- [x] MFA (TOTP): enroll (encrypted secret + otpauth QR) / enable / disable + login challenge — verified 7/7
- [x] Profile editing (PATCH /me/profile) + /settings page (verified)
- [x] DSAR compliance: data export (/me/export) + account erasure/anonymization (DELETE /me) + settings UI — verified
- [x] Consent management: append-only consent API (latest-wins) + cookie-consent banner (DPDP) — verified
- [x] Support tickets: create/list/reply(threaded)/close + admin queue (RBAC, ownership) + /support page — verified
- [~] Google OAuth (server flow) pending — needs real Google credentials to verify
- [x] Auth unit tests (password + token/rotation); integration/e2e pending Phase 7

## Phase 3 — Catalog & listings  ✅ verified end-to-end
- [x] Categories (data-driven attribute schema) endpoint + cached tree
- [x] Listings CRUD + seller state machine + **attribute validation vs category schema**
- [x] Risk-gated publish (ACTIVE vs PENDING_REVIEW) via rules risk engine + FraudEvent
- [x] ABAC ownership on update/pause/delete (verified 403 for non-owner)
- [x] Media signed-upload URL (presigned S3/MinIO) + content-type/size limits
- [x] Search (Postgres FTS ranked) + filters (price/category/condition/verified/rating) + ILIKE autocomplete
- [x] Async media-scan worker (BullMQ): scan on attach → scanStatus → REJECTED media hidden — verified
- [x] Listing variants CRUD (add/list/update/delete, ABAC) + included in listing detail — verified
- [x] Listing boost/promote: POST /listings/:id/boost -> sponsored top of browse (active-only, ABAC) — verified
- [x] Saved searches: store+list+run(re-execute)+delete (new migration; FTS column declared Unsupported) — verified
- [x] Wishlist: add/remove/has/list API + listing heart toggle + /wishlist page (verified)
- [x] Address book: CRUD API (auto-default, default reassignment, ABAC) + /addresses page (verified)

## Phase 4 — Commerce  ✅ verified end-to-end (24/24 E2E)
- [x] Idempotency interceptor (Redis: fingerprint + in-flight lock + cache-before-emit)
- [x] Orders + actor-aware state machine + timeline + inventory (SOLD/restock)
- [x] **Oversell-proof checkout**: stock reserved atomically at checkout (conditional
      `UPDATE ... WHERE quantity >= n`), not at payment; `stock_held` flag makes release
      idempotent; DB CHECK constraint backs it; 15-min reservation sweeper (Redis-fenced)
      reclaims abandoned checkouts — verified 14-buyer stampede on 5 units → exactly 5 win
- [x] Payments: Razorpay + Cashfree behind one provider port (per-provider webhook HMAC), idempotent capture + ledger — verified
- [x] Reviews (verified-purchase) + reputation recompute
- [x] Coupons: admin/seller creation + checkout discount (atomic redemption limit, release-on-cancel) — verified 6/6
- [x] Messaging (threads, messages, structured offers accept/decline/counter)
- [x] Socket.IO realtime gateway (JWT handshake, participant-checked rooms, live delivery,
      Redis adapter for horizontal scale) + live web chat — verified 5/5

## Phase 5 — Trust & safety  ✅ verified end-to-end (13/13 E2E)
- [x] Risk engine (rules) + FraudEvent gating publish (from Phase 3, exercised here)
- [x] Reports + moderation actions + prioritized queue (RBAC) + hash-chained audit log
- [x] Disputes (open party-only/state-gated, admin resolve → refund/audit)
- [x] Users public trust profile (score + badges, no PII) + follow
- [x] BullMQ async worker (in-process): email off the request path (register 0.1s), retries+backoff
- [x] Explainable trust-score recompute (0–100 from verification/rating/sales/tenure − disputes/fraud),
      stored with per-factor breakdown; triggered on email/phone/ID verify, reviews, delivered orders — verified 5→15
- [x] Notifications: persist + realtime push on order/message/offer events; web bell +
      /notifications page (live unread count) — verified 4/4

## Phase 6 — Frontend (apps/web, Next.js)  ✅ core slice verified against live API
- [x] Next.js 15 App Router + Tailwind + design tokens (light/dark, no-FOUC) + UI primitives
- [x] Design language rebuilt: paired type scale (size+leading+tracking), fill-not-outline
      tiles, one accent reserved for actions, Container/Section/Field/EmptyState/Skeleton,
      stroked icon set, skip link + visible focus + reduced-motion
- [x] API client (SSR direct / browser proxy) + client auth (login/register/refresh, in-mem token)
- [x] Home (SSR + revalidate), Search (live FTS), Listing detail (SSR + JSON-LD + trust panel)
- [x] Sell page (auth-gated, data-driven category attribute form → risk-checked publish)
- [x] Buyer/seller dashboard, public profile (+reviews), messages/chat (offers accept/decline),
      order detail (timeline + role-aware transitions + pay)
- [x] Admin console UI: fraud queue + reports + disputes, approve/reject actions (RBAC-gated)
- [x] Verified live: SSR pages render with seeded data; all client pages 200; next build clean (12 routes)
- [x] Browser smoke (Chromium): register→cookie→sell→create→detail→theme 7/7; admin console loads live queue

## Phase 7 — Hardening & delivery
- [x] Test suites: 44 unit + 9 black-box E2E suites (82 API checks); `pnpm test:e2e:live`
      runs them all behind one exit code; repeatable (3 consecutive clean passes)
- [x] Security scans in CI (dep audit + gitleaks + Semgrep; Trivy/ZAP → when images publish)
- [x] Observability: Prometheus /metrics (default + RED per-route histograms) — verified live
- [x] Deploy config: multi-stage Dockerfiles (api + web standalone), docker-compose.prod,
      Caddy edge (auto-HTTPS + security headers), runtime migrate-on-boot, .dockerignore
- [x] SessionStart hook (auto-provision Postgres/Redis/.env/deps/migrate/seed)
- [x] Hot-row relief: listing view counts buffered in Redis + batch-flushed, so browse
      traffic no longer takes a row lock on the row checkout reserves stock on
- [x] Rate limit driven by RATE_LIMIT_* env (was hardcoded), tunable for a sale
- [x] Browse-feed partial indexes (recent / price / boosted / category): measured on a
      300k-row catalogue, 78ms full scans -> 0.3ms index scans; boosted feed 57ms -> 0.04ms

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
- S5: Hardening pass driven by "survive a sale". Found and fixed a real oversell:
  concurrent checkout let 14 buyers take 5 units and left the listing at quantity -9,
  then relisted it while negative. Replaced read-then-write with atomic reservation at
  checkout + idempotent release + a DB CHECK + an expiry sweeper. Then found the second
  half of the same problem: every listing view wrote `view_count` on the row checkout
  needs to lock, so browsing throttled buying — 900 views meant 900 lock-taking writes.
  Buffered those in Redis with a batched flush (900 views → 0 row writes). Rebuilt the
  design system around a quiet, type-led language and carried it through the listing,
  auth and search surfaces, making the explainable trust breakdown the centrepiece.
  Fixed three latent defects on the way: the Tailwind TS config was silently falling
  back to a default theme (no jiti/sucrase installed) so every custom token was being
  dropped; the listing endpoint leaked internal fraud/dispute penalty scores; and the
  E2E suites only passed against a virgin database. LESSON: a silent fallback is worse
  than a crash — the styles "worked" for weeks because the old class names happened to
  resolve elsewhere.
  Closed the session with a query-plan pass: every browse query was sequential-scanning
  the whole catalogue and sorting it (78ms / 15,870 buffers at 300k rows), and the
  sponsored-listings query — which runs on every page-1 load — scanned all 300k rows to
  return none. Four partial indexes matching the browse predicate took those to 0.3ms
  and 0.04ms. Also added sign-out (the API had the endpoint; the web client never called
  it) and an auth-aware header. Next: consider a short-TTL cache for listing detail, and
  the same query-plan pass over the per-user tables.
