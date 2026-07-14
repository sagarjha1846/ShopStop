# 02 — Personas & User Journeys

## Personas

### P1 — Priya, the Casual Seller (26, Pune)
- **Context:** Decluttering; wants to sell a used phone, some furniture, a few books.
- **Goals:** List fast, avoid scammers/time-wasters, get a fair price, meet safely.
- **Pains:** Lowball spam, "is this available?" noise, fear of fake payment screenshots, no-shows.
- **Trust needs:** Verified buyers, clear buyer ratings, safe-meeting guidance.
- **Success:** Lists in < 3 min, chats only with verified buyers, completes sale, gets a review.

### P2 — Rahul, the Power Reseller (34, Delhi)
- **Context:** Runs a small refurb-electronics business; lists 30–50 items/week.
- **Goals:** Bulk-friendly listing, inventory/variants, reliable payouts, boosted visibility, analytics.
- **Pains:** High marketplace fees, slow payouts, chargebacks, competitor copycats.
- **Trust needs:** Verified-seller badge, high trust score, dispute protection.
- **Success:** Steady orders, strong seller score, low dispute rate, predictable settlement.

### P3 — Anita, the Cautious First-Time Buyer (29, Bengaluru)
- **Context:** Wants a used road bike; has been scammed on Facebook Marketplace before.
- **Goals:** Buy from someone trustworthy, pay safely, have recourse if it goes wrong.
- **Pains:** Fake listings, advance-payment scams, no dispute path, no identity behind the seller.
- **Trust needs:** Verified seller, escrow (Phase 2), reviews with photos, report/dispute flow.
- **Success:** Buys confidently from a verified seller; protected payment; leaves a review.

### P4 — Vikram, the High-Intent Buyer (41, Hyderabad)
- **Context:** Buying a used car / evaluating a rental flat — high-value, high-risk.
- **Goals:** Verify the item and the person, negotiate, avoid fraud on large sums.
- **Pains:** Title/ownership fraud, deposit scams, impersonation.
- **Trust needs:** Strong identity verification, category-specific attributes, in-app record of agreement.
- **Success:** Verifies seller + item details, negotiates in-app (auditable), transacts safely.

### P5 — Sana, the Trust & Safety Admin (internal)
- **Context:** Reviews flagged listings/users, works the moderation & fraud queues, resolves disputes.
- **Goals:** Triage fast, act decisively (approve/reject/suspend/ban), full audit trail.
- **Pains:** Alert overload, false positives, no context, slow tooling.
- **Trust needs:** Prioritized queues, risk explanations, one-click actions, immutable audit log.
- **Success:** Median takedown < 30 min; low false-positive rate; every action logged.

### P6 — Dev, the Platform Engineer (internal)
- **Context:** Runs the modular monolith on a small budget.
- **Goals:** Ship safely, observe the system, keep costs low, pass VAPT.
- **Pains:** On-call noise, cost creep, security debt.
- **Success:** Green CI/CD, healthy dashboards, predictable bill, clean pentest.

---

## User Journeys

### J1 — Seller creates a listing (Priya)
1. Sign up (email or Google) → prompted to **verify phone (OTP)** and email.
2. Tap **Sell** → pick category (e.g., Electronics → Mobile Phones).
3. Form renders **category-specific attributes** (brand, model, storage, condition) from the category's attribute schema — no code change to support new fields.
4. Add photos (drag/drop, client-side compression, malware/NSFW scan on upload), price, "negotiable" toggle, location.
5. Save as **draft** or **publish**. Publish runs **risk checks** (duplicate/spam/keyword/image moderation). Low risk → live; medium → shadow/limited; high → admin queue.
6. Listing appears in search; Priya can **boost/pause/archive/duplicate** later.

### J2 — Buyer discovers and evaluates (Anita)
1. Land on home → curated categories, trending, recently listed, "verified sellers".
2. Search "road bike" → autocomplete → results with filters (price, condition, location radius, verified seller, rating).
3. Open product page → gallery, specs, **seller trust panel** (trust score, badges, member since, completed orders, response time, reviews).
4. **Ask a question** or **make an offer**; add to **wishlist**; **report** if suspicious.

### J3 — Negotiate & agree (Anita ↔ Priya)
1. Buyer opens chat → typing indicators, read receipts, online status.
2. Buyer sends **structured offer** (₹ amount); seller can accept/counter/decline.
3. Optional image/file sharing (moderated). All messages retained for dispute evidence.
4. On accept → an **order** is created in `PENDING`.

### J4 — Pay & fulfill (MVP: manual coordination)
1. Buyer pays via **Razorpay** (UPI/cards/net-banking/wallets) → webhook confirms → order `ACCEPTED`.
2. Seller marks `PACKED` → `SHIPPED` (or arranges safe meetup) → buyer confirms `DELIVERED`.
3. Both parties **review** each other (verified-purchase review). Trust scores update.
4. *Phase 2:* funds held in **escrow**, released on delivery confirmation; **payouts** to seller.

### J5 — Something goes wrong → dispute (Vikram)
1. Buyer opens a **dispute** on the order (item not as described / not delivered).
2. System freezes settlement (Phase 2 escrow) and opens a **case** with the full chat + order timeline as evidence.
3. Admin (Sana) reviews context and risk signals → resolves (refund / release / partial / ban).
4. Outcome recorded in dispute history; affects both parties' trust scores.

### J6 — Fraud attempt is contained (Sana + risk engine)
1. A new account creates 20 near-identical high-value listings from a datacenter IP with an impossible-travel login.
2. **Risk engine** scores the events → listings auto-held, account rate-limited, alert raised.
3. Sana sees a **prioritized fraud alert** with the signals explained → bans account, purges listings.
4. Victims never see the listings. Action is logged to the **tamper-evident audit log**.

### J7 — Admin moderation loop (Sana)
1. Report comes in (listing/user/message) → enters moderation queue with reason + reporter history.
2. Sana reviews → approve / reject / suspend / temporary-restrict / ban.
3. Action notifies the affected user, updates trust signals, and is fully audit-logged.

### J8 — Buyer & seller dashboards (steady state)
- **Buyer:** orders, wishlist, saved searches/sellers, addresses, payment methods, messages, notifications, support.
- **Seller:** sales, revenue, inventory, orders, messages, coupons/promotions (Phase 2), insights, followers, performance metrics, payouts (Phase 2).
