# 03 — Feature List (MVP / Phase 2 / Future)

Legend: **[MVP]** ship first · **[P2]** phase 2 · **[F]** future. Each block notes the cut line.

> **MVP cut principle:** ship the smallest thing that lets a buyer safely transact with a stranger and feel protected. Everything that isn't on that critical path is deferred. Trust primitives are **not** deferrable — they are the product.

## 1. Authentication & Identity
- **[MVP]** Email/password (Argon2id), Email verification, **Phone OTP**, Google OAuth, session via short-lived JWT access + rotating refresh (httpOnly secure cookie).
- **[MVP]** MFA (TOTP) opt-in; forced for admins.
- **[P2]** Apple Login.
- **[F]** Aadhaar/PAN/DigiLocker KYC, business/brand verification.

## 2. User Profiles & Trust
- **[MVP]** Buyer + seller profile (same account, dual capability), avatar, bio, member-since, location.
- **[MVP]** **Trust score v1** (verification + behavior), **verification badges** (email/phone), ratings & reviews, completed orders, response time.
- **[MVP]** Followers / following, seller statistics.
- **[P2]** Verified-business/brand badges, buyer score & fraud score surfaced, richer stats.

## 3. Listings (data-driven, category-agnostic)
- **[MVP]** Create / draft / publish / pause / archive / delete / **duplicate**; multiple images; **category + subcategory + attribute schema per category**; tags; location; price; **negotiable**; condition; inventory (simple); **variants** (basic).
- **[MVP]** **Digital product mode** and **Service mode** flags (delivery semantics differ).
- **[P2]** Video upload, boost/promote (paid visibility), coupons on listings.
- **[F]** 360° images, **auction mode**, **rental mode**, AI-generated descriptions, AI price suggestions, auto-categorization.

## 4. Search & Discovery
- **[MVP]** Postgres full-text search + trigram; autocomplete; filters (category, price, condition, location radius, seller rating, verified sellers, recently listed); sorting; trending (simple popularity); saved-search stubs.
- **[P2]** OpenSearch/Elasticsearch, saved searches with alerts, "delivery available" filter, better ranking.
- **[F]** AI-assisted/semantic search, personalized recommendations.

## 5. Product Page
- **[MVP]** Gallery, specs (from attributes), seller trust panel, reviews, Q&A, share, wishlist, **report listing**, related/recommended (basic "same category").
- **[F]** ML recommendations, "compare", price history.

## 6. Messaging
- **[MVP]** Buyer↔seller real-time chat (Socket.IO), **structured offers** (accept/counter/decline), read receipts, typing indicators, online/last-seen, image/file sharing (moderated), report message.
- **[P2]** Message templates, quick replies, block/mute.

## 7. Notifications
- **[MVP]** In-app + email (transactional), preference center.
- **[P2]** Web push, SMS (OTP is MVP via provider; marketing SMS later).

## 8. Orders
- **[MVP]** Lifecycle: `PENDING → ACCEPTED → PACKED → SHIPPED → DELIVERED`; plus `REJECTED / CANCELLED / RETURNED / REFUNDED`. State machine enforced server-side; timeline visible to both parties.
- **[P2]** Returns workflow UI, partial fulfillment.

## 9. Payments (India-first)
- **[MVP]** **Razorpay** (UPI, UPI Intent, cards, net-banking, wallets, payment links), **webhook-driven, idempotent** capture/confirm.
- **[P2]** Cashfree, PhonePe PG, **escrow**, **seller payouts**, **split settlements**, refunds automation, EMI.
- **[F]** Wallet/credits, subscription billing for boosts.

## 10. Delivery / Logistics
- **[MVP]** No integration — buyer/seller coordinate (in-person or self-ship); order captures address + tracking-note field.
- **[P2]** Shiprocket, Delhivery, Bluedart, DTDC (rate cards, label generation, tracking webhooks).

## 11. Reviews & Reputation
- **[MVP]** Buyer→seller and seller→buyer reviews, **verified-purchase** flag, star + text, photo reviews.
- **[P2]** Review responses, helpfulness voting, review moderation ML.

## 12. Trust, Anti-Fraud & Moderation — **core differentiator** (see [10](10-trust-and-antifraud.md))
- **[MVP]** **Risk engine (rules)**: rate limiting, suspicious-login + impossible-travel detection, device fingerprinting, duplicate/spam/keyword listing detection, image moderation (NSFW/illegal), multi-account signals, listing-frequency monitoring, payment-anomaly checks. **Admin review queues**. Report listing/user/message. Approve/reject/suspend/ban/temporary-restrict. DMCA/copyright intake.
- **[P2]** ML fraud scoring, image similarity/duplicate detection, high-risk transaction alerts, richer scam detection.
- **[F]** Model-driven fraud prediction, network/graph analysis of collusion rings.

## 13. Admin Portal (Sana)
- **[MVP]** Dashboard (users/listings/orders/reports), **moderation queue**, **fraud alerts**, disputes, audit logs, feature flags, basic system config.
- **[P2]** Revenue/analytics dashboards, support tickets, payout ops.

## 14. Seller Dashboard (Rahul)
- **[MVP]** Sales, orders, inventory, messages, followers, basic performance metrics.
- **[P2]** Revenue analytics, coupons/promotions, insights, boost management, payouts.

## 15. Buyer Dashboard (Anita)
- **[MVP]** Orders, wishlist, addresses, payment methods, messages, notifications, support.
- **[P2]** Saved searches (with alerts), saved sellers, richer support/ticketing.

## 16. Legal & Consent
- **[MVP]** ToS, Privacy Policy, Refund Policy, Seller/Buyer Agreements, Cookie Consent, Prohibited Items Policy, DMCA policy; DPDP consent capture; DSAR export/delete stubs.
- **[P2]** Full consent manager, automated DSAR pipeline.

## 17. Analytics
- **[MVP]** Product analytics events (privacy-respecting), funnel basics.
- **[P2]** Seller/buyer analytics, conversion/retention/revenue, popular categories, search analytics.
- **[F]** Heatmaps, cohort/BI warehouse.

## 18. AI Features (all Future, API-first so they bolt on)
- Auto listing descriptions, price suggestions, fraud prediction, duplicate detection, smart/semantic search, recommendations, chat assistant, image enhancement, auto-categorization, spam detection.

## 19. Mobile
- **[MVP]** Responsive PWA-ready web; API-first so **React Native** needs **no backend change**.
- **[F]** React Native apps (iOS/Android), push via FCM/APNs.

---

## MVP definition of done (the launchable slice)
A verified user can: **list** an item with category attributes and photos (risk-checked) → another verified user can **find** it, **chat/offer**, **pay via Razorpay**, move it through the **order lifecycle**, **review** the counterparty, and **report/dispute** if needed — while admins **moderate** a prioritized queue and **the risk engine** contains fraud, all behind an **OWASP-clean, VAPT-ready** stack.
