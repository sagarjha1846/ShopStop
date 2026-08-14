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
- [x] Public listing Q&A (docs/03 §5): ask/answer/list + moderation hide, seller-only answers,
      shared prohibited-keyword screening, handles never emails in public reads, asker notified
      on answer. Counts toward funnel liquidity alongside chat threads — verified 18/18

## Phase 4 — Commerce  ✅ verified end-to-end (24/24 E2E)
- [x] Idempotency interceptor (Redis: fingerprint + in-flight lock + cache-before-emit)
- [x] Orders + actor-aware state machine + timeline + inventory (SOLD/restock)
- [x] Payments: Razorpay + Cashfree behind one provider port (per-provider webhook HMAC), idempotent capture + ledger — verified
- [x] Browser callback verification (`POST /payments/verify`): checkout's missing half. The
      gateway hands the browser a signed `HMAC(order_id|payment_id, KEY_SECRET)` on success —
      a different key *and* payload shape from the webhook signature — and we verified only
      webhooks, so a buyer had no way to be told their payment worked. Confirms in the same
      idempotent capture the webhook uses, so whichever lands first books the money and the
      other is a no-op. Authenticated + ownership-checked: the signature proves the gateway
      made the payload, not who is replaying it — verified 16/16
- [x] Reviews (verified-purchase) + reputation recompute
- [x] Coupons: admin/seller creation + checkout discount (atomic redemption limit, release-on-cancel) — verified 6/6
- [x] Messaging (threads, messages, structured offers accept/decline/counter)
- [x] Read state (docs/03 §6): per-thread unread counts + read receipts + live `thread:read`
      event. ThreadParticipant.lastReadAt had always been written and never read back, so the
      data existed and was simply unexposed — verified 9/9
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
- [x] Notification preference centre: per-category in-app/email channels (defaults + locked
      security category), gating inside notify(), queued transactional email (verified-address
      only, HTML-escaped), /settings toggles, preferences in the DSAR export — verified 13/13

## Phase 6 — Frontend (apps/web, Next.js)  ✅ core slice verified against live API
- [x] Next.js 15 App Router + Tailwind + design tokens (light/dark, no-FOUC) + UI primitives
- [x] API client (SSR direct / browser proxy) + client auth (login/register/refresh, in-mem token)
- [x] Home (SSR + revalidate), Search (live FTS), Listing detail (SSR + JSON-LD + trust panel)
- [x] Sell page (auth-gated, data-driven category attribute form → risk-checked publish)
- [x] Buyer/seller dashboard, public profile (+reviews), messages/chat (offers accept/decline),
      order detail (timeline + role-aware transitions + pay)
- [x] Admin console UI: fraud queue + reports + disputes, approve/reject actions (RBAC-gated)
- [x] Verified live: SSR pages render with seeded data; all client pages 200; next build clean (12 routes)
- [x] Browser smoke (Chromium): register→cookie→sell→create→detail→theme 7/7; admin console loads live queue

## Phase 8 — Monetization (making the business real)
- [x] Platform commission booked to the ledger: FEE transaction written atomically with
      CHARGE on capture; take rate moved to config (PLATFORM_FEE_BPS) and snapshotted per
      order so rate changes never re-price history — verified 20/20
- [x] Fixed a money bug: capture used read-then-write, so concurrent duplicate webhook
      deliveries each wrote ledger rows (measured: 4 deliveries → 4× GMV and 4× fee).
      Now a compare-and-set inside the transaction; exactly one delivery books.
- [x] Seller earnings API + dashboard panel (gross / platform fee / net, settled vs in-flight)
- [x] Admin revenue API + console panel (GMV, fee revenue, take rate, AOV, daily series),
      ADMIN-only (moderators excluded)
- [x] Refunds reverse the commission: dispute-refund resolution now writes a REFUND row plus a
      negative-FEE contra entry, and refunded sales drop out of seller settled earnings. Previously
      the refund only flipped order status, so the platform kept its cut of a refunded sale and
      `refundedMinor` was structurally always zero — verified 25/25
- [x] Commission margin by payment method: revenue now splits GMV/commission by payment method
      and estimates gateway cost per method (UPI zero-MDR, card MDR_CARD_BPS), so "fee revenue"
      is no longer read as profit. Measured live: card volume nets exactly zero — the 2% take
      rate is priced at card processing cost — while UPI keeps the full commission
- [x] Paid seller plans (ShopStop Pro, ₹799/30d): sold through the same provider port, activated
      on capture, booked as its own revenue stream. Sells *capability* — listing allowance 10→50/hr
      enforced in the risk engine, included boost credit — and deliberately not trust: the
      BUSINESS/IDENTITY badges stay tied to verification and are asserted unbuyable in the E2E.
      Cancelling keeps the period already paid for. Included boost credit is redeemable:
      boosts spend plan days before charging (full or partial coverage), credit-covered
      boosts book no revenue (already paid via the subscription), reserve/release on
      failure, conditional update so concurrent boosts can't spend the same balance
      — verified 41/41
- [x] Paid sponsored placement: boosts were free + unlimited (lost revenue, and a boost
      everyone can take signals nothing). Now priced (BOOST_PRICE_PER_DAY_MINOR), sold via
      the existing provider port, and activated only on capture; stacks onto an unexpired
      window. Booked as a separate revenue stream — deliberately not counted as GMV, since
      ad spend is not merchandise — verified 20/20

- [x] Settlement liability (`GET /admin/payables`, ADMIN-only): the other side of the revenue
      report. The platform collects the buyer's full payment and owes the seller everything
      but its commission, from capture until settlement — the largest number on the balance
      sheet, and nothing in the system stated it, so neither the float nor the liability could
      be quantified. Reports held / releasable / withheld / overdue, aged from the CHARGE row,
      per seller. Money is releasable only once delivered and dispute-free; the default is to
      withhold, so an unknown status can never be mistaken for payable. Computed twice — by
      walking orders and by summing the ledger — and the drift between them is reported rather
      than reconciled away. Measured live on seed data: ₹6,13,160 held against ₹19,863 earned,
      a 31:1 float-to-revenue ratio, which is the docs/16 F1 exposure as a number rather than
      a paragraph
- [x] Settlement recording (`POST /admin/payables/settle`): PAYOUT had sat in TransactionType
      since Phase 2 and was written nowhere, so held money could only ever grow. Admin records
      a transfer against a mandatory real-world reference (UTR/batch id) and the PAYOUT rows
      take it out of the held balance. The bank rail stays external — there is no payout
      integration and pretending otherwise would be worse than not having one. Guarded by a
      `SELECT … FOR UPDATE` on the candidate orders rather than a status read, since paying a
      seller twice is not recoverable: proved by removing the lock, where 3 of 6 concurrent
      settlements paid (₹26,460 sent for ₹8,820 of sales) and the reconciliation independently
      caught it as drift
- [x] Seller payout view (`GET /me/payouts`): "when do I get paid" is the question a seller
      actually has, and there was no honest way to answer it until settlement existed. Shows
      held / releasable / withheld, lifetime paid, and payout history grouped by settlement
      batch with the transfer reference. Scoped to the caller — never takes a seller id, and
      the E2E asserts a second account sees zeros rather than someone else's history. Lifetime
      paid is its own aggregate rather than a sum of the 20-row history, so a seller past their
      twentieth payout is not shown less than they were paid — verified 55/55
- [x] Payables + payouts in the product, not just the API: admin console gains a Payables
      panel (held / ready / withheld / overdue, per-seller table, and a Record-payout action
      that asks for the bank reference before writing anything) and the seller dashboard gains
      a Payouts panel with history and the transfer reference against each line, so a seller
      can match a payout to their own bank statement. The reconciliation is shown, and drift
      is rendered in red with settlement disabled — a wrong ledger should stop payouts, not be
      hidden behind a reassuring total. Also fixed a live mislabel: the dashboard called
      captured-sale net "Paid out to you", which told sellers they had money that had never
      been sent; it now reads "Earned (after fees)" with actual payouts in their own panel.
      Verified in Chromium against the live API — both panels render real figures
- [x] Fixed silent money loss on partial refunds: `RESOLVED_PARTIAL` was a selectable
      dispute outcome that moved **zero money**. Resolve took no amount, only
      `RESOLVED_REFUND` booked anything, so the dispute closed, the audit chain recorded a
      partial refund, and the buyer received nothing while the seller kept the full amount
      and the platform kept its full commission. Measured before the fix: Δrefunded=0,
      Δfee=0, Δheld=0 on a 201 response. Now `refundAmountMinor` is required for PARTIAL
      (and rejected for other outcomes), the REFUND row is written for the amount, and the
      commission is reversed *in proportion* so the platform and the seller share the
      goodwill rather than the seller carrying it. Payables now nets refunds per order
      instead of filtering on `status = REFUNDED`, since a partial refund leaves the order
      DELIVERED — without that the seller would still have been shown owed the full amount
      and settlement would have paid it out. Also closed a read-then-write race in
      `resolve()` that let two admins book a refund on the same dispute
- [x] Refunds actually reach the gateway. `bookRefund` wrote REFUND + contra-FEE rows and
      called no payment API at all — the provider port had no `refund()` and none of the
      adapters implemented one. The books asserted money had gone back to the buyer while
      the buyer's card was never touched, which in production is a chargeback (and, at
      volume, a terminated gateway account). Added `refund()` to the port with the same
      dev-mode fallback `createIntent` uses, Razorpay's `POST /payments/:id/refund` behind
      it keyed on the dispute id so a retry cannot refund twice at the gateway, and
      `PaymentsService.refundToBuyer()` as the entry point. Ordering is deliberate: the
      gateway call happens *before* the ledger write, and if it fails the dispute is handed
      back to OPEN so an admin can retry — a REFUND row for a transfer that never happened
      is worse than a failed resolution. REFUND rows now carry the gateway's refund id.
      Verified against a real limitation rather than a mock: Cashfree implements no refund,
      and resolving one of its orders returns 409, books nothing, and leaves the dispute in
      the queue. Known gap: Cashfree refunds are unimplemented — deliberately refused
      loudly rather than silently doing nothing
- [x] Every path that ends a paid sale now refunds. Two more were silently keeping the
      buyer's money: cancelling an ACCEPTED (already captured) order, and the order state
      machine's `refund` action, which a seller can invoke. Both changed status and did
      nothing else — measured: cancel a paid 9,000 order and Δrefunded=0; use the refund
      action and the order reads REFUNDED with Δrefunded=0 and the commission still booked.
      Refunds now live in one `RefundsService` that all three callers share (disputes,
      cancel, refund action), with the gateway call ahead of the ledger write and the order
      status left to the caller — a buyer cancelling leaves CANCELLED, a dispute refund
      leaves REFUNDED, a partial leaves the order untouched. Conflating money with state is
      what let "REFUNDED" mean nothing. Never refunds more than was charged, which doubles
      as the idempotency guard. Structurally, refunds sit in their own module depending only
      on the gateway adapters: payments depends on orders, so hanging refunds off
      PaymentsModule would have closed a cycle — verified 80/80
- [x] Closed the Cashfree refund gap that the previous slice left open. Refusing loudly was
      safe but it meant a Cashfree order could no longer be cancelled *at all*, since a paid
      order that cannot be refunded must not move to a status claiming it was. Implemented
      against Cashfree's documented API, where two things differ from Razorpay and both are
      easy to get wrong: refunds key on the order rather than the payment, and amounts are in
      major units — the same conversion the webhook parser already does in reverse. The live
      branch is unexercised (createIntent is still a stub for this provider, so it cannot take
      a live payment to refund) and says so; it is safe meanwhile because a failed call throws
      and books nothing. Also added `refunds.service.spec.ts` (6 unit tests) for the ordering
      guarantee the E2E can no longer reach now that both adapters succeed in dev: a refusing
      gateway writes no ledger row, an uncaptured or already-refunded order never calls out,
      over-refunding is refused, and a provider without `refund()` fails loudly
- [x] Disputes are resolvable from the admin console. The panel listed open disputes and
      offered no actions at all — every resolution, refund included, was curl-only, so the
      partial-refund fix was unreachable from the product. Now each dispute carries Refund in
      full / Partial refund (with an amount box validated to a real slice of the charge —
      zero is a release and the whole amount is a full refund, each with its own button) /
      Release to seller, and gateway failures surface instead of being swallowed, since a
      refused refund leaves the dispute open and the operator needs to know why. Driven in
      Chromium against the live API: a ₹2,500 partial refund on a ₹10,000 order moved
      exactly ₹2,500 back, reversed ₹50 of commission, left the reconciliation at zero drift
      and cleared the dispute from the queue

## Phase 9 — Measurement & operations
- [x] Feature flags (docs/03 §13): declared registry with defaults, admin list/toggle, 30s
      cache with immediate local invalidation, audited on every change. Wired to real
      behaviour rather than left as CRUD — `monetization.commission` prices orders at 0%
      (the launch phase from docs/18 R5, no redeploy) and `listings.questions` is a kill
      switch for the public Q&A surface — verified 16/16
- [x] Funnel report: the PRD's success metrics (docs/01 §7) computed from live operational
      data — activation, liquidity, conversion, dispute rate, verified-party share, retention
      proxy, plus the north star (dispute-free transactions/week). Derived from listings /
      threads / orders / disputes, so no event pipeline and it works retroactively.
      Percentages ship with their numerator+denominator, empty denominators report null rather
      than a fake 0%, activation only counts cohorts that have had a full 7 days, and the one
      metric that genuinely can't be computed is reported as such with the reason.
      GET /admin/funnel (ADMIN-only) + admin console panel — verified 22/22

## Phase 7 — Hardening & delivery
- [x] Test suites: 47 unit + 17 black-box E2E suites (352 API checks); CI runs unit +
      commerce/trust/notification-preferences/revenue/boosts/subscriptions/funnel/questions/feature-flags/read-receipts/payment-verify/payables E2E
- [x] Security scans in CI (dep audit + gitleaks + Semgrep; Trivy/ZAP → when images publish)
- [x] Observability: Prometheus /metrics (default + RED per-route histograms) — verified live
- [x] Deploy config: multi-stage Dockerfiles (api + web standalone), docker-compose.prod,
      Caddy edge (auto-HTTPS + security headers), runtime migrate-on-boot, .dockerignore
- [x] SessionStart hook (auto-provision Postgres/Redis/.env/deps/migrate/seed)
- [x] Images published to GHCR on every push (release.yml, built-in token — no secrets to set),
      plus docker-compose.deploy.yml that pulls rather than builds. Verified: both images
      anonymously pullable from ghcr.io. Fixed two real blockers found by running it — the API
      Dockerfile's `pnpm deploy` invocation was broken under pnpm 10 (the image had never built),
      and Trivy was pinned to a nonexistent action version, which failed the job at setup.

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
- S5–S7: Phase 6 frontend + the Phase 3/4/5 breadth listed above (realtime chat, metrics,
  notifications, wishlist, MFA, addresses, async worker, coupons, saved searches, DSAR,
  support, media scan, consent, Cashfree, variants, boost, trust recompute). Session-log
  entries were not written at the time; the phase checklists above are the record.
- S8: Notification preference centre — closed the last open MVP item in docs/03 §7. Added the
  NotificationPreference model + migration, a category taxonomy with pure resolution rules
  (defaults → override → locked), GET/PATCH /me/notification-preferences, and gating inside
  notify() so muting a category actually suppresses delivery. Wired the email channel through
  the existing notify queue. Two real fixes found by doing this: (1) `prisma migrate dev`
  wanted to drop the hand-written FTS indexes + the search_vector generated expression — the
  migration was trimmed to the new table only; (2) MailService.send swallowed SMTP errors, so
  the worker logged every failed send as complete and BullMQ's configured 3-attempt backoff
  never fired — now it propagates. Verified live: 13/13 new E2E, 41 unit tests, all 9 E2E
  suites green (no regressions), preference centre driven in Chromium, both apps build clean.
- S9: Monetization. The platform computed a 2% fee onto every order and then never booked
  it — `TransactionType.FEE` was declared but never written, so revenue existed nowhere in
  the ledger and no one could answer "what did we earn?". Booked the commission atomically
  with the charge, moved the take rate to config, and added seller earnings + an admin
  revenue summary (both read from the ledger, not restated from the order table).
  Found and fixed a real money bug while testing: capture did read-then-write on payment
  status, so concurrent duplicate webhook deliveries (which gateways do routinely) each
  wrote ledger rows — measured 4× GMV and 4× fee from 4 parallel deliveries, now exactly
  once via compare-and-set. Also fixed two pre-existing test defects that only appear on
  reruns: suites tripping the listing-velocity risk rule, and cashfree.e2e hardcoding a
  cf_payment_id that lands in a unique column. Verified: 20/20 revenue E2E, all 9 suites
  green (97 checks), 41 unit tests, earnings + revenue panels driven in Chromium.
- S10: Paid boosts — the second revenue line. Sponsored placement was granted for free and
  without limit, so it earned nothing and meant nothing. BoostPurchase carries its own
  provider ids rather than reusing Payment (1:1 with an order), which keeps the order money
  path — the most safety-critical code here — completely untouched. Boost revenue is booked
  as FEE with meta.basis='boost' and reported as its own stream; it is deliberately excluded
  from GMV and from the take-rate denominator so those numbers stay sanity-checkable.
  Verified: 20/20 boosts E2E (including 4 concurrent deliveries booking once and window
  stacking), all 10 suites green (117 checks), Promote flow driven in Chromium.
