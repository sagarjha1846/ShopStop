# 11 — Security Architecture

Design assumption: **this application will undergo VAPT.** Build OWASP-clean from day one. The pre-pentest checklist is [12](12-vapt-checklist.md).

## OWASP Top 10 (2021) — mitigations

| Risk | Mitigation in ShopStop |
|---|---|
| **A01 Broken Access Control** | Central **RBAC** guards (USER/MODERATOR/ADMIN) + **ABAC** for ownership ("is this *your* listing/order?"). Every controller declares required policy; deny-by-default. No client-trusted role claims beyond signed JWT. IDOR-tested (see VAPT). |
| **A02 Cryptographic Failures** | TLS 1.2+ everywhere (HSTS). Passwords **Argon2id**. Secrets & `mfaSecret` **encrypted at rest** (envelope encryption + KMS). Refresh tokens stored **hashed**. No sensitive data in JWT/logs/URLs. |
| **A03 Injection** | Prisma parameterized queries (no string SQL); DTO validation (class-validator/Zod) with allow-lists; output encoding; search uses `websearch_to_tsquery`, not raw interpolation. |
| **A04 Insecure Design** | Threat-modeled flows (auth, payments, disputes), state machines enforced server-side, idempotency on money paths, abuse rate limits, trust/risk engine as a first-class control. |
| **A05 Security Misconfiguration** | Hardened headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy). No default creds. Env-driven config validated at boot. Error responses leak nothing (generic + `requestId`). |
| **A06 Vulnerable Components** | Dependency scanning (Dependabot + `npm audit`/Snyk in CI), container image scanning (Trivy), pinned base images, lockfiles. |
| **A07 Auth Failures** | Short-lived access JWT + rotating refresh with **reuse detection** (revoke family on theft), MFA (TOTP), OTP throttling, account lockout/backoff, secure cookies, CAPTCHA on high-risk auth. |
| **A08 Integrity Failures** | Signed webhooks (verify provider signature), SRI where applicable, CI provenance, no untrusted deserialization, hash-chained audit log. |
| **A09 Logging/Monitoring Failures** | Structured, PII-scrubbed logs; security events (login, privilege change, moderation, payment) audited; alerting + SIEM-ready export ([14](14-monitoring-and-logging.md)). |
| **A10 SSRF** | No user-supplied URLs fetched server-side without allow-list; media is client-direct-to-S3 via signed URLs; outbound calls restricted; metadata endpoints blocked. |

## Authentication & session
- **Access token:** JWT, ~15 min, in memory only (never localStorage).
- **Refresh token:** opaque, rotated on every use, stored **hashed** in `Session`, delivered as **httpOnly + Secure + SameSite=Lax** cookie; **reuse detection** revokes the whole session family.
- **MFA:** TOTP opt-in for users, **mandatory for admins/moderators**.
- **OAuth:** Google (MVP), Apple (P2) via server-side code exchange; no implicit flow.
- **CSRF:** cookie-based refresh protected by SameSite + CSRF token on state-changing form posts; APIs use Bearer tokens (not ambient cookies) which are CSRF-immune.

## Authorization
- **RBAC** for coarse roles; **ABAC** for resource ownership and state (e.g., only the seller can `PACK`; only a party to an order can dispute it). Policies centralized and unit-tested; **default deny**.

## Input, output, file safety
- All input validated + normalized at the edge; unknown fields stripped.
- Output encoded; React escapes by default; CSP blocks inline/unsafe scripts.
- **Secure file uploads:** signed, size/content-type-limited direct-to-S3; server never trusts client MIME; async **virus + NSFW + illegal-image scan**; files served via **signed, expiring URLs**; images re-encoded to strip EXIF/geolocation + payloads; no execution of uploaded content.

## Rate limiting, bots, throttling
- Redis token buckets per IP + per user; stricter on auth/OTP/listing/messaging.
- CAPTCHA + device/bot heuristics on signup and high-risk actions.
- API gateway / reverse proxy (Nginx/Traefik) enforces global limits + WAF-style rules; Cloudflare-style edge protection when budget allows.

## Data protection (PII, encryption, backups)
- **In transit:** TLS 1.2+ / HSTS. **At rest:** encrypted DB volume + app-level envelope encryption for secrets/KYC refs; managed KMS for keys.
- **PII minimization:** collect only what's needed; access to PII is logged; DSAR **export/delete** supported (DPDP/GDPR).
- **Card data** never touches our servers (PCI scope stays with the gateway). **KYC docs** never in primary DB — encrypted vault/provider token only.
- **Backups:** automated encrypted Postgres backups (daily full + PITR/WAL), tested restores, offsite copy; documented RPO/RTO ([13](13-devops-and-deployment.md)).

## Secrets management
- No secrets in the repo. Env vars from a secrets manager (Doppler/AWS Secrets Manager/SSM). Rotation policy for JWT signing keys (key-id in header for rotation), DB creds, gateway keys. CI secrets scoped + masked; secret-scanning on the repo.

## Security headers (baseline)
```
Content-Security-Policy: default-src 'self'; img-src 'self' https://cdn.shopstop.app data:; script-src 'self'; connect-src 'self' https://api.shopstop.app wss://api.shopstop.app; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=()
```

## Audit logging (tamper-evident)
- Every privileged/security-relevant action → `AuditLog` with actor, target, IP, metadata.
- **Hash chain:** each row stores `hash = sha256(prevHash + canonical(row))`, making silent tampering detectable. Logs are append-only, exported to durable/immutable storage for SIEM.

## Compliance posture
- **DPDP Act 2023** (consent, data-principal rights, breach notice, minimization) and **GDPR-aware** primitives (DSAR, DPA with processors, lawful basis). See [01](01-prd.md#legal--compliance).

## Application security in SDLC
- **SAST** (CodeQL/Semgrep), **DAST** (OWASP ZAP against staging), **dependency + container scanning**, secret scanning — all in CI ([13](13-devops-and-deployment.md)). Security review of the diff on each PR.
