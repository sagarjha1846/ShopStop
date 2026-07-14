# 10 — Trust, Anti-Fraud & Moderation (the differentiator)

> This is the product. Listings are a commodity; **trust is not.** If a user doesn't trust ShopStop more than OLX or Facebook Marketplace, they have no reason to switch. Everything here is what makes that switch worth it — and what's hardest for a competitor to copy, because it compounds with data and reputation over time.

## The trust stack (four layers)

```
4. Dispute resolution   ── recourse when things go wrong (structured, evidence-based)
3. Reputation & scores  ── legible, portable trust (badges, trust score, reviews)
2. Fraud / risk engine  ── catch bad actors *before* they reach victims
1. Identity verification ── know who is behind the account
```

## Layer 1 — Identity verification
- **MVP:** email + phone OTP verification → `EMAIL` / `PHONE` badges. Verified parties are prioritized in ranking and unlock higher trust weight.
- **Phase 2/Future:** Aadhaar/PAN/DigiLocker identity, GSTIN business verification, brand verification → `IDENTITY` / `BUSINESS` badges. KYC docs never touch the primary DB — only a provider reference/token in an encrypted vault ([11](11-security-architecture.md)).
- **Progressive trust:** unverified users can browse and list at low limits; verification unlocks higher listing frequency, higher-value categories, and payouts.

## Layer 2 — Risk engine (rules first, ML later)
A single evaluation pipeline scores events (`login`, `listing.publish`, `order`, `payment`, `message`). Each rule contributes to an **aggregate risk score (0–100)** with an **explanation** stored on the `FraudEvent` so admins see *why*.

### MVP signals (all rule-based, cheap)
| Signal | How | Action band |
|---|---|---|
| **Impossible travel** | login geo/IP vs. last login vs. elapsed time | medium→high |
| **Suspicious login** | new device + new geo + off-pattern hour | medium |
| **Device fingerprinting** | client fingerprint reused across accounts | multi-account flag |
| **Multi-account detection** | shared device/IP/phone/payment instrument | medium→high |
| **Duplicate listing** | near-identical title/desc/images/price by same or linked accounts | hold |
| **Spam listing** | listing velocity spike, templated content | rate-limit + hold |
| **Keyword monitoring** | prohibited-goods / scam-phrase dictionary | hold + review |
| **Image moderation** | NSFW/illegal classifier on upload | reject media + review |
| **Payment anomaly** | amount/velocity outliers, mismatched payer | high + freeze |
| **Rate-limit breach** | auth/listing/message buckets exceeded | throttle + flag |
| **Listing frequency** | new account posting many high-value items fast | hold + verify |
| **High-risk transaction** | high value + low-trust counterparties | alert + (P2) escrow-required |

### Action bands
- **Low:** allow.
- **Medium:** shadow-limit (reduced reach), require verification/CAPTCHA, soft-warn.
- **High:** auto-hold the subject (listing → `PENDING_REVIEW`, account → `RESTRICTED`), raise a **prioritized fraud alert**, and — critically — **victims never see it**.

### Phase 2/Future — ML
- Gradient-boosted / logistic fraud-probability model trained on labeled outcomes (confirmed fraud vs. false positive from the queue). Image-similarity embeddings for duplicate detection. Graph analysis to surface **collusion rings** (linked accounts reviewing/buying from each other). The rules layer stays as guardrails + training-label source.

## Layer 3 — Reputation & trust scores (legible + portable)
- **Trust score (0–100)** per user, **explainable** via `TrustScore.factors`:
  - verification level (email/phone/identity/business)
  - completed transactions & tenure
  - review quality (verified-purchase, recency-weighted)
  - dispute history (opened against them, outcomes)
  - risk/fraud signals (inverse)
  - response time & reliability
- **Buyer score & seller score** so both sides are accountable (a seller can decline a low-trust buyer; sellers are rated by buyers *and* buyers rated by sellers).
- **Fraud score** (internal-leaning) surfaces to admins and gates high-risk actions.
- Scores + badges render everywhere ([08](08-frontend-architecture.md)) so trust informs every decision. Recomputed by the `reputation` worker on relevant events.

## Layer 4 — Dispute resolution (recourse)
- A buyer/seller opens a **dispute** on an order → case opens with the **full chat + order timeline + offers as evidence** (this is why offers and negotiation live in-app, [05](05-database-schema.md)).
- **Phase 2 escrow:** funds are held; opening a dispute **freezes settlement** until resolution.
- Admin resolves: `RESOLVED_REFUND` / `RESOLVED_RELEASE` / `RESOLVED_PARTIAL` / `REJECTED`. Outcome updates both parties' trust/dispute history and is **audit-logged**.
- Transparent, evidence-based resolution is the thing OLX/FB Marketplace structurally cannot offer — it's our moat.

## Moderation (human-in-the-loop)
- **Intake:** report a listing / user / message (reason + details); auto-flags from the risk engine also enter the queue.
- **Queue:** prioritized by risk score + reporter history + subject value; each item shows context and the risk explanation for fast triage.
- **Decisions:** approve · reject · suspend · ban · temporary-restrict · dismiss — one click, all **audit-logged** (hash-chained, [11](11-security-architecture.md)).
- **Content policy enforcement:** prohibited/illegal goods, NSFW, counterfeit, copyright/**DMCA** takedowns (formal intake + counter-notice workflow).
- **SLA target:** median time-to-takedown for flagged listings **< 30 min** ([01](01-prd.md) metrics).

## Abuse-resistance guardrails
- Rate limits on account creation, listing, messaging, reviews.
- Reviews only from **completed orders** (`verified`), so reputation can't be farmed cheaply.
- CAPTCHA / bot detection on signup + high-risk actions.
- New/low-trust accounts face progressive limits until they earn trust.

## Why this compounds (the moat)
Every transaction, review, dispute outcome, and fraud label makes the scores sharper and the models better. A competitor starting today has **no reputation graph and no labeled fraud data** — and can't buy either. Trust is the asset that gets more valuable the longer we run and the harder it is to replicate.
