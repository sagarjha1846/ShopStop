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
node test/e2e/commerce.e2e.mjs   # offers → order → payment webhook → fulfilment → review
node test/e2e/trust.e2e.mjs      # risk hold → moderation queue (RBAC) → reject/approve → profile
node test/e2e/notification-preferences.e2e.mjs  # preference centre gates delivery
# realtime needs a socket client: npm i socket.io-client (or run from a dir that has it)
node test/e2e/realtime.e2e.mjs   # socket auth → thread:join ABAC → live message:new → anon reject
```
Each prints PASS/FAIL per assertion and exits non-zero on any failure.

## Coverage
- **commerce**: listing publish, offer negotiate/accept, idempotent order create,
  idempotency-key body-mismatch 409, payment intent, HMAC-signed webhook capture,
  webhook replay idempotency, invalid-signature rejection, full order state machine
  with actor authorization, inventory → SOLD, verified-purchase reviews.
- **trust**: risk-engine hold of prohibited-keyword listings, hidden-from-browse,
  reporting, RBAC-gated moderation queue, reject/approve decisions, public trust
  profile without PII, dispute not-found guard.
- **notification-preferences**: default taxonomy, muting a category actually
  suppresses in-app delivery, re-enabling restores it, unrelated categories keep
  firing, locked security categories and unknown categories rejected (422),
  per-user isolation, preferences present in the DSAR export.

CI runs these against an ephemeral stack (see `.github/workflows/ci.yml`, extended
in Phase 7). For a typed integration suite, these can be ported to Jest + supertest.
