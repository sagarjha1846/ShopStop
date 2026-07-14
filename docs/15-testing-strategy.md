# 15 — Testing Strategy

Philosophy: **test the risky seams** (money, auth, access control, state machines, trust engine) hardest. A pragmatic pyramid — lots of fast unit tests, focused integration tests, a thin but real E2E layer — plus performance and security gates in CI.

## Test pyramid

```
        ▲  E2E (Playwright) — few, critical journeys
       ███ Integration (API + DB + Redis) — moderate
      █████ Unit (services, guards, state machines, risk rules) — many
```

## Unit tests
- **Domain services** with mocked repositories: pricing/total calc, coupon rules, trust-score computation, **risk-engine rules** (each signal + aggregation bands), review eligibility.
- **State machines:** order + listing transitions — assert every illegal transition throws `409`.
- **Guards/policies:** RBAC + ABAC ownership matrices (this is where IDOR bugs die).
- Tooling: **Vitest/Jest**. Target **≥ 80%** on domain logic (coverage gate in CI, but quality > number).

## Integration tests
- Real **Postgres + Redis** (Testcontainers or CI service containers), Prisma against a migrated schema.
- Cover: auth (register/login/refresh rotation + reuse detection), listing publish → risk hold, order + **payment webhook idempotency** (replay a webhook twice → one capture), dispute open/resolve, moderation action + audit-log hash chain, search filters.
- **Contract tests** against `api/openapi.yaml` so provider/consumer stay in sync ([06](06-api-spec.md)).

## E2E tests (Playwright)
Thin, high-value journeys against an ephemeral Compose stack:
1. Sign up → verify phone → create listing (with category attributes + image) → publish.
2. Second user searches → opens listing → chats → sends offer → seller accepts.
3. Buyer pays (gateway in **test mode**) → order advances to delivered → both review.
4. Buyer reports a listing → admin moderates → listing removed.
5. Fraud path: scripted abusive behavior → risk engine holds → admin bans.
- Run headless in CI; a11y assertions (axe) on key pages.

## Performance testing
- **k6** load scenarios: search + browse (read-heavy), listing create (write), checkout (money path), chat fan-out (websocket).
- Targets: p95 read < 300ms, checkout < 1s server-side, sustained N rps per scale tier ([17](17-scaling-roadmap.md)); soak test for leaks; spike test for autoscale/queue behavior.
- Front-end: **Lighthouse CI** budget enforcing Core Web Vitals ([08](08-frontend-architecture.md)) — LCP < 2.5s, INP < 200ms, CLS < 0.1.

## Security testing (in CI + periodic)
- **SAST:** CodeQL/Semgrep on every PR.
- **DAST:** OWASP ZAP baseline against staging.
- **Dependency + container scan:** `npm audit`/Snyk + Trivy.
- **Secret scanning:** on repo + CI.
- Manual: the **VAPT checklist** ([12](12-vapt-checklist.md)) before launch + after major changes; annual third-party pentest.

## Accessibility testing
- axe-core in E2E, manual keyboard/screen-reader passes on core flows, contrast checks in both themes — WCAG 2.1 AA gate.

## Test data & environments
- Deterministic **seed** (category tree + attribute schemas, demo users/listings). Gateways, email, S3 use test/mock services locally (Razorpay test mode, MailHog, MinIO). No prod data in tests.

## CI gates (block merge)
- typecheck + lint + unit + integration green, coverage ≥ threshold, SAST/deps/secret scans clean of highs, E2E smoke green, Lighthouse budget met, no Prisma drift. See [13](13-devops-and-deployment.md).

## What we deliberately don't over-test
- Trivial getters/DTOs, third-party internals, generated code. Effort goes to money, auth, access control, and trust — where a bug is expensive or dangerous.
