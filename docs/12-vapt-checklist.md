# 12 — VAPT Checklist (pre-pentest hardening)

Run this before engaging a VAPT team. `[ ]` = verify/prove, not just "we intend to." Grouped by area; maps to [11](11-security-architecture.md).

## Authentication & session
- [ ] Passwords hashed with **Argon2id** (tuned params); no MD5/SHA-1/bcrypt-only legacy.
- [ ] Access JWT short-lived (~15m); refresh rotated with **reuse detection**; family revocation on theft.
- [ ] Refresh token stored **hashed**; cookie is httpOnly + Secure + SameSite.
- [ ] MFA (TOTP) available; **enforced for admin/moderator**.
- [ ] OTP endpoints throttled + expiry + attempt limits; no OTP in logs.
- [ ] Login lockout/backoff; generic error (no user-enumeration via timing/messages).
- [ ] Password reset uses single-use, expiring, unguessable tokens; no account takeover via reset.
- [ ] Logout + "log out all sessions" revoke server-side.

## Authorization / access control
- [ ] **IDOR** tested on every object route (listings, orders, messages, media, disputes) — cross-user access denied.
- [ ] RBAC enforced server-side (never client role trust); ABAC ownership checks on all mutations.
- [ ] Admin endpoints require admin role **and** MFA; no admin route reachable by USER.
- [ ] State-machine actions authorized by party+state (e.g., only seller can PACK).
- [ ] Mass-assignment blocked (DTO allow-lists; can't set `role`, `status`, `priceMinor` on others' objects).

## Injection & input
- [ ] SQL injection: all queries via Prisma/params; no string concatenation; search sanitized.
- [ ] XSS: stored + reflected tested; React escaping intact; CSP blocks inline scripts.
- [ ] NoSQL/command/template injection: N/A or covered; no `eval`/dynamic requires on input.
- [ ] File upload: type/size validated server-side; content sniffed; malware/NSFW scan; EXIF stripped; no path traversal in storage keys.
- [ ] SSRF: no server fetch of user URLs without allow-list; cloud metadata endpoints blocked.

## Session / transport / headers
- [ ] TLS 1.2+ only; HSTS preload; no mixed content.
- [ ] CSP, X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy present and correct.
- [ ] Cookies: Secure, httpOnly, SameSite; no sensitive data in localStorage/URLs.
- [ ] CSRF protection on cookie-authenticated state changes.
- [ ] CORS allow-list (no `*` with credentials).

## Business logic & payments
- [ ] Idempotency enforced on `/orders`, `/payments/intent`; replay-safe.
- [ ] Payment webhook **signature verified**; amount/currency validated against order; no client-set price trusted.
- [ ] Order state machine can't be skipped/reversed via crafted requests (409 on illegal transitions).
- [ ] No price/quantity/coupon tampering (server recomputes totals; coupon limits enforced).
- [ ] Race conditions on stock/coupon/refund handled (DB transactions / row locks).
- [ ] Refund/dispute flows can't double-refund or release+refund the same funds.

## Rate limiting & abuse
- [ ] Per-IP + per-user limits on auth, OTP, listing create, messaging, reviews.
- [ ] CAPTCHA/bot detection on signup + high-risk actions.
- [ ] Account-creation abuse + multi-account detection active.
- [ ] Enumeration (users, listings, orders) rate-limited and non-revealing.

## Data protection & privacy
- [ ] PII access logged; DSAR export/delete functional (DPDP/GDPR).
- [ ] Secrets encrypted at rest; no secrets in repo/CI logs; secret scanning enabled.
- [ ] KYC docs not in primary DB; card data never on our servers.
- [ ] Backups encrypted; restore tested; PITR verified.
- [ ] Audit log tamper-evident (hash chain) and append-only.

## Logging / monitoring
- [ ] Security events logged (login, priv change, moderation, payment, refund).
- [ ] Logs PII-scrubbed; alerting on anomalies; SIEM export.
- [ ] `requestId` correlation end-to-end; no stack traces to clients.

## Infra / pipeline
- [ ] SAST (CodeQL/Semgrep), DAST (ZAP on staging), dependency + container scan (Trivy) green in CI.
- [ ] No debug endpoints / verbose errors / source maps exposed in prod.
- [ ] Least-privilege IAM (S3 bucket policy, DB user, deploy role); no public S3 buckets.
- [ ] Reverse proxy WAF rules + request size limits; Swagger/`/api/docs` gated in prod.
- [ ] Container runs as non-root; read-only FS where possible; healthchecks; secrets via env not baked into image.

## Post-VAPT
- [ ] Triage findings by severity; fix criticals/highs before launch; retest.
- [ ] Track exceptions with risk acceptance + owner + review date.
