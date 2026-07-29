# API end-to-end scripts

Black-box HTTP tests that drive the running API through complete flows. They are
plain Node scripts (global `fetch`) so they need no test-runner wiring and double
as executable documentation of the happy paths + guardrails.

## Prerequisites
- Postgres + Redis running, DB migrated + seeded (`pnpm db:migrate:deploy && pnpm db:seed`).
- API running on `localhost:4000` (`pnpm build && node dist/main.js`).
- The seeded demo admin (`admin@shopstop.local` / `AdminPass123!`) must exist.

## Run
```bash
pnpm test:e2e:live               # every suite, aggregated, non-zero exit on any failure
```
Or one at a time:
```bash
node test/e2e/commerce.e2e.mjs   # offers → order → payment webhook → fulfilment → review
node test/e2e/inventory.e2e.mjs  # concurrent checkout stampede → no oversell
node test/e2e/trust.e2e.mjs      # risk hold → moderation queue (RBAC) → reject/approve → profile
node test/e2e/realtime.e2e.mjs   # socket auth → thread:join ABAC → live message:new → anon reject
```
Each prints PASS/FAIL per assertion and exits non-zero on any failure.

### Re-running
Suites publish listings as the seeded demo admin, and the risk engine holds any seller
who posts 10+ listings in an hour — that rule is doing its job, but a full pass creates
enough listings that a second back-to-back pass trips it and listings land in
PENDING_REVIEW instead of ACTIVE. Re-seed between passes:
```bash
pnpm db:reset                    # destructive: drops + remigrates + reseeds the dev DB
```

## Coverage
- **commerce**: listing publish, offer negotiate/accept, idempotent order create,
  idempotency-key body-mismatch 409, payment intent, HMAC-signed webhook capture,
  webhook replay idempotency, invalid-signature rejection, full order state machine
  with actor authorization, inventory → SOLD, verified-purchase reviews.
- **inventory**: 14 buyers checking out a 5-unit listing at the same instant — exactly
  5 win and 9 get a clean 409, stock never goes negative, the depleted listing flips to
  SOLD, accepting an order does not double-decrement, a cancel restocks exactly once,
  and a double-cancel mints no phantom stock.
- **trust**: risk-engine hold of prohibited-keyword listings, hidden-from-browse,
  reporting, RBAC-gated moderation queue, reject/approve decisions, public trust
  profile without PII, dispute not-found guard.

CI runs these against an ephemeral stack (see `.github/workflows/ci.yml`, extended
in Phase 7). For a typed integration suite, these can be ported to Jest + supertest.
