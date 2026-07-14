# 18 — Risks, Trade-offs & Mitigations

Honest risk register. Severity × likelihood is a rough founder's read, not a precise model.

## Top product/business risks

### R1 — Cold-start liquidity (Sev: High · Likely: High)
No buyers without sellers; no sellers without buyers. The classic marketplace chicken-and-egg.
- **Mitigation:** launch **single-category, single-city** (concentrate liquidity, e.g., used electronics in one metro). Seed supply first (recruit resellers like Rahul), subsidize early trust (free verification/boosts). Measure listing→message→transaction funnel per micro-market before expanding. Category-agnostic design means we expand by **data**, not rebuilds.

### R2 — Trust promise vs. reality (Sev: High · Likely: Medium)
Our entire pitch is "safer than OLX/FB." If a high-profile scam slips through early, the differentiator inverts into a liability.
- **Mitigation:** ship the trust layer in **MVP, not later** ([03](03-features.md)). Aggressive moderation SLA (<30 min takedown). Conservative risk thresholds early (accept more false positives to protect reputation), loosen as data improves. Publish transparency (dispute outcomes, takedown stats) to build credibility.

### R3 — Fraud arms race (Sev: High · Likely: High)
Fraudsters adapt; rules get gamed; ML needs labeled data we don't have yet.
- **Mitigation:** rules-first (works day one) → ML once labeled data accrues from the moderation/dispute loop ([10](10-trust-and-antifraud.md)). Defense in depth (identity + risk + reputation + disputes) so no single bypass wins. Human-in-the-loop for high-risk. Continuous red-teaming of our own flows.

### R4 — Payments/escrow regulatory complexity in India (Sev: High · Likely: Medium)
Holding/settling funds implicates RBI norms (PA/PG, escrow, nodal accounts). Getting this wrong is existential.
- **Mitigation:** **stay a facilitator** — route money through licensed gateways (Razorpay/Cashfree/PhonePe); don't custody funds directly. Defer escrow to Phase 2 and implement via a licensed partner's escrow/split-settlement product, with legal review. GST/invoicing handled for business sellers.

### R5 — Unit economics / take-rate vs. trust cost (Sev: Medium · Likely: Medium)
Trust (verification, moderation, disputes, fraud tooling) costs money; too high a take-rate pushes users back to free FB Marketplace.
- **Mitigation:** monetize where trust is worth paying for — **boosts/promotions**, verified-business subscriptions, optional escrow fee on high-value transactions — rather than taxing every P2P sale. Keep infra cost/MAU tiny ([16](16-cost-estimation.md)) so the burn is low while liquidity builds.

## Technical risks & trade-offs

### R6 — Modular monolith bet (Trade-off, chosen deliberately)
A monolith could become a big-ball-of-mud if seams erode.
- **Trade-off accepted:** massively lower cost/complexity now vs. a future extraction cost. **Mitigation:** enforce module boundaries via domain events + service interfaces (no cross-module table access); lint/architecture tests; extract only under metric pressure ([17](17-scaling-roadmap.md)).

### R7 — Postgres FTS won't scale forever (Known limit)
Fine to ~100K users; relevance/latency degrade at scale.
- **Mitigation:** search behind an **adapter interface** so OpenSearch is a swap, not a rewrite. Migrate when search latency crosses threshold.

### R8 — Single-VPS single point of failure (Sev: Medium · Likely: Medium at Tier 0)
One box = one failure domain; a bad deploy or disk-full takes everything down.
- **Mitigation:** health-gated deploys + auto-rollback, tested backups + PITR (RPO ≤15m/RTO ≤2h), move DB off-box at 10K users, multi-instance by 100K ([13](13-devops-and-deployment.md)). Acceptable risk at launch given cost constraints; explicitly time-boxed.

### R9 — Content moderation cost/scale (Sev: Medium · Likely: High as we grow)
Human moderation doesn't scale linearly; illegal-goods liability is real.
- **Mitigation:** automate triage (risk engine pre-filters, prioritized queue), community reporting, clear prohibited-items policy, image/keyword classifiers; scale human review with volume; DMCA + legal workflows in place.

### R10 — Data protection / breach (Sev: High · Likely: Low-Medium)
PII + (future) KYC + payment metadata is a target; DPDP breach obligations are strict.
- **Mitigation:** minimize PII, encrypt at rest/in transit, KYC never in primary DB, hash-chained audit, VAPT before launch, secret scanning, least-privilege IAM ([11](11-security-architecture.md), [12](12-vapt-checklist.md)). Breach runbook + notification process ready.

### R11 — Solo/small-team bus factor & scope (Sev: Medium · Likely: High)
The feature list is enormous; a small team can drown.
- **Mitigation:** ruthless MVP cut line ([03](03-features.md)) — trust primitives + the single transaction loop, everything else phased. Buy don't build (gateways, email, KYC, scanning). AI-assisted development. Ship the single-category wedge before breadth.

## Explicit trade-offs table
| Decision | We gain | We give up | Why it's right now |
|---|---|---|---|
| Modular monolith | speed, low cost, simplicity | independent scaling | ≤100K users don't need services |
| Postgres FTS (not OpenSearch) | $0 extra, one datastore | ranking sophistication | good enough to 100K; swap-ready |
| No logistics in MVP | scope + cost | convenience/coverage | coordination works P2P; couriers P2 |
| Facilitator, no fund custody | regulatory safety | escrow UX (until P2) | avoids RBI custody complexity |
| Rules-first fraud (not ML) | works day one, cheap | some sophistication | no labeled data yet; rules generate it |
| Single VPS at launch | minimal cost | HA | time-boxed; DB off-box at 10K |
| Web-first, no native app | one codebase | app-store presence | API-first → RN later, no backend change |

## Kill-criteria / watch metrics
- Dispute rate per 100 tx stuck **> 2** after tuning → trust promise failing; pause growth, fix.
- Listing→transaction funnel **< target** per micro-market after seeding → liquidity thesis weak; re-scope category/city.
- Infra cost/MAU trending toward **₹2+** → architecture or usage problem; investigate before scaling spend.
