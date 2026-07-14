# 01 — Product Requirements Document (PRD)

## 1. Summary

ShopStop is a **category-agnostic, peer-to-peer marketplace** that lets people legally buy and sell almost anything. The platform never holds inventory; it is a **trusted facilitator**. Our wedge against incumbents (OLX, Facebook Marketplace, eBay) is a **trust layer**: identity verification, an active fraud/risk engine, transparent buyer↔seller communication, and structured dispute resolution.

- **Product type:** Two-sided marketplace (C2C first, C2C+B2C later).
- **Geography:** India-first (payments, KYC, DPDP Act), architected for other regions.
- **Budget posture:** Side project, low infra cost, open-source-first, no Kubernetes initially.
- **Scale target:** ~100,000 users with no architectural change; roadmap to 1M.

## 2. Vision

> Enable anyone to sell or purchase almost anything that is legal, and make each transaction **safer than any competing platform**.

The platform is **category-agnostic and data-driven**: adding a new category (Electronics, Cars, Real Estate, Services, Handmade, Digital, Agriculture, Machinery, Art, Fashion, Pets where legal, …) must require **no backend code change** — only data (category tree + attribute schema).

## 3. Problem

Peer-to-peer commerce today forces a bad trade:

- **Facebook Marketplace / OLX:** huge reach, near-zero trust — rampant scams, no recourse, no verified identity, no escrow, disputes are on your own.
- **Amazon / Flipkart:** high trust, but curated/closed, high seller fees, not truly "sell anything peer-to-peer", cluttered UX.

There is no product that combines **open peer-to-peer breadth** with **institutional-grade trust**. That gap is the opportunity.

## 4. Goals & Non-Goals

### Goals (what success looks like)
1. A buyer can find, evaluate, and safely transact with a stranger and **feel protected**.
2. A seller can list in minutes, reach real buyers, and **get paid reliably**.
3. Fraud is detected and contained **before** it reaches victims, not after.
4. Trust is **legible** (badges, scores, history) and **portable** across the platform.
5. The whole thing runs on a **small monthly budget** and a **small team**.

### Non-Goals (explicitly out of scope, at least for MVP)
- We do **not** own inventory or warehouses.
- We are **not** building our own logistics network in MVP (buyer/seller coordinate; couriers in Phase 2).
- We are **not** building native mobile apps in MVP (API-first so RN comes free later).
- We are **not** doing auctions, rentals, or full escrow in MVP (designed-for, shipped later).
- We are **not** competing on catalog breadth of managed retail; we compete on **trust**.

## 5. Guiding principles
- **Trust before revenue.** Earn trust, then monetize. Don't sacrifice safety for take-rate.
- **Data-driven categories.** No code deploy to add a vertical.
- **Cost-conscious by default.** Every service must justify its monthly cost and its scaling point (see [16](16-cost-estimation.md)).
- **Secure by design.** Assume a VAPT. Ship OWASP-clean (see [11](11-security-architecture.md), [12](12-vapt-checklist.md)).
- **API-first.** Web today, React Native tomorrow, zero backend changes.
- **Modular monolith.** One deployable, clean seams, extractable later. No premature microservices.

## 6. Target users (summary — full personas in [02](02-personas-and-journeys.md))
- **Priya** — casual seller decluttering her home.
- **Rahul** — power reseller running a small electronics business.
- **Anita** — cautious first-time buyer, scam-averse.
- **Vikram** — high-intent buyer (cars, real estate) needing verification.
- **Sana** — trust & safety / moderation admin.
- **Dev** — platform/ops engineer.

## 7. Success metrics (North Star + guardrails)

**North Star:** *Number of successfully completed, dispute-free transactions per week.* It captures both sides transacting **and** trust holding.

| Category | Metric | MVP target (first 6 mo) |
|---|---|---|
| Acquisition | Weekly new verified users | Growth trend positive |
| Activation | % new users who list or message within 7 days | > 25% |
| Liquidity | Listing → first-message rate | > 15% |
| Conversion | Message → completed transaction | > 8% |
| **Trust (NSM)** | Dispute rate per 100 transactions | **< 2** |
| Trust | % transactions with ≥1 verified party | > 70% |
| Safety | Median time-to-takedown for flagged listing | < 30 min |
| Safety | Fraud caught pre-victim / total fraud attempts | > 80% |
| Retention | 30-day returning user rate | > 30% |
| Cost | Infra cost per monthly active user | < ₹2 / MAU |

## 8. Scope by phase (see [03](03-features.md) for the full list)
- **MVP:** Auth (email + phone OTP + Google), data-driven listings with media, Postgres FTS search + filters, product pages, buyer↔seller chat, offers, order lifecycle (manual coordination), one payment gateway (Razorpay), reviews, reports, **core trust layer** (email/phone verification, trust score v1, risk rules, admin moderation queue), buyer & seller dashboards.
- **Phase 2:** More gateways (Cashfree/PhonePe), escrow, courier integrations (Shiprocket/Delhivery), OpenSearch, richer fraud ML, payouts/split settlements, coupons/promotions, saved searches, push/SMS.
- **Future:** Auctions, rentals, AI listing generation & pricing, recommendations, native apps, Aadhaar/PAN KYC, business/brand verification.

## 9. Constraints & assumptions
- Small team, limited budget → prefer managed-but-cheap and open-source; avoid ops-heavy infra.
- India-first regulatory surface: **RBI** rules for payments/escrow, **DPDP Act 2023** for personal data, GST implications for business sellers.
- Single-region deployment initially; multi-AZ/region is a Phase 2+ concern.
- Legal categories only; prohibited-goods policy enforced by moderation + risk engine.

## 10. Legal & compliance
- **Policies required at launch:** Terms of Service, Privacy Policy, Refund Policy, Seller Agreement, Buyer Agreement, Cookie Consent, Prohibited Items Policy, DMCA/Copyright policy.
- **DPDP Act 2023 (India):** lawful basis + consent for personal data, data-principal rights (access/correction/erasure), breach notification, data minimization, consent manager pattern.
- **GDPR-aware:** same primitives (DSAR export/delete, consent, DPA with processors) so EU expansion is incremental, not a rewrite.
- **Payments:** ShopStop is a facilitator; settlement/escrow handled through licensed PA/PG partners (Razorpay/Cashfree/PhonePe) to stay within RBI norms — we do not hold customer funds directly.
- **Prohibited goods:** weapons, drugs, counterfeit, endangered wildlife, stolen goods, regulated pets, etc. — blocked via category rules + keyword/image moderation + human review.

## 11. Key risks (full register in [18](18-risks-and-tradeoffs.md))
- **Cold-start liquidity** (no buyers without sellers and vice-versa).
- **Fraud arms race** (our core promise; must stay ahead).
- **Payments/escrow regulatory complexity** in India.
- **Moderation cost & scale** as content grows.
- **Unit economics** — take-rate vs. trust investment.
