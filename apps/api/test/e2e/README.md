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
node test/e2e/revenue.e2e.mjs    # commission booked to the ledger → earnings + admin revenue
node test/e2e/boosts.e2e.mjs     # sponsored placement is sold: pay → activate → book revenue
node test/e2e/subscriptions.e2e.mjs  # paid seller plans: capability, never a trust badge
node test/e2e/funnel.e2e.mjs     # the PRD's success metrics computed from live data
node test/e2e/questions.e2e.mjs  # public listing Q&A: ask → answer → counts as liquidity
node test/e2e/feature-flags.e2e.mjs  # switches that change behaviour, not just persist
node test/e2e/read-receipts.e2e.mjs  # unread counts + read receipts, and inbox isolation
node test/e2e/payment-verify.e2e.mjs # browser payment callback: signature → capture, no double-book
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
- **revenue**: commission priced onto the order, CHARGE + FEE booked to the
  ledger on capture, replayed *and* concurrent duplicate webhooks book exactly
  once, seller earnings (gross/fee/net, settled vs in-flight), admin revenue
  summary (GMV, fee revenue, take rate, daily series), admin-only authorization.
- **boosts**: published pricing, a purchase does not grant placement until the
  capture webhook lands, activation opens the paid window, revenue booked as a
  separate stream (and deliberately not counted as GMV), replayed *and* concurrent
  deliveries book once, a second boost stacks onto the remaining window, ABAC +
  auth + day-cap guards.
- **subscriptions**: public pricing, benefits withheld until capture, activation
  books its own revenue stream (not GMV, not commission, take rate unmoved),
  the raised listing allowance is enforced by the risk engine (free seller held
  where a Pro seller publishes), paying grants no verification badge, replayed
  captures book once, cancel keeps the paid period.
- **funnel**: admin-only access, all seven docs/01 §7 metrics present with their
  targets, percentages reconcile with their own numerator/denominator, empty
  denominators report null rather than a fake zero, and the report tracks real
  activity (publishing widens the liquidity denominator, a first message moves
  the numerator).
- **questions**: auth + ABAC (seller can't ask on their own listing, only the
  seller answers, answered once), prohibited-keyword screening shared with
  listings, public reads that expose a handle and never an email, asker notified
  on answer, moderation hide, and a question counting toward funnel liquidity.
- **feature-flags**: admin-only, declared flags listed even when never set,
  unknown keys rejected as 422, and both switches proven to change behaviour —
  commission drops to zero and back, an order priced fee-free stays fee-free
  after re-enabling, the Q&A kill switch closes asking while leaving existing
  answers readable. Restores flags on exit, since they are global state.
- **payment-verify**: the browser callback half of checkout — a forged signature is
  rejected as a client error (422, never a 5xx that invites a retry) and leaves the
  order PENDING, confirmation requires auth and order ownership (a valid signature
  proves the gateway made the payload, not who is replaying it), a valid callback
  captures and books GMV + commission, a later webhook for the same payment converges
  instead of double-booking, replays are no-ops, unknown provider orders 404.
- **read-receipts**: per-thread unread counts (own messages never unread to you),
  opening a thread clears them, a later message goes unread again, the
  counterparty read position is exposed and does not advance on its own, and a
  stranger neither sees the thread nor can read it (403).

CI runs these against an ephemeral stack (see `.github/workflows/ci.yml`, extended
in Phase 7). For a typed integration suite, these can be ported to Jest + supertest.
