# 04 — Information Architecture, Wireframes & Design System

## Design north star
Modern, minimal, premium, playful — inspired by **Airbnb** (warmth + trust), **Stripe** (clarity), **Apple/Linear** (restraint), **Notion** (calm), **Instagram/Discord** (social energy). **Not** Amazon (cluttered). Glassmorphism used sparingly, rounded cards, vibrant accent, fast, animated, light + dark.

## Sitemap

```
/
├── /                         Home (explore-first)
├── /search                   Results (facets, map/list)
├── /c/[category]/[sub?]      Category browse
├── /l/[listingId]/[slug]     Listing (product) page
├── /u/[handle]               Public seller/buyer profile
├── /sell                     Create/edit listing wizard
├── /messages/[threadId?]     Chat inbox
├── /wishlist
├── /orders/[orderId?]        Order timeline
├── /dashboard
│   ├── /buyer                Orders, wishlist, saved, addresses, payments
│   └── /seller               Listings, sales, inventory, insights, followers
├── /notifications
├── /settings                 Profile, security (MFA), privacy/consent, notifications
├── /auth/(login|register|verify|reset)
├── /legal/(terms|privacy|refund|seller|buyer|prohibited|cookies|dmca)
├── /support
└── /admin                    (RBAC-gated)
    ├── /queue                Moderation queue
    ├── /fraud                Fraud alerts
    ├── /disputes
    ├── /users  /listings  /orders  /payments
    ├── /audit                Audit log
    └── /config               Feature flags, system config
```

## Global navigation
- **Top bar:** logo · category mega-menu · search (command-palette style) · Sell (primary CTA) · messages · notifications · avatar menu · theme toggle.
- **Mobile:** bottom tab bar — Home · Search · **Sell** (center, elevated) · Messages · Profile.
- **Trust surfaced everywhere:** verified badges and trust score appear on cards, product pages, chat headers, and checkout.

## Textual wireframes

### Home (`/`)
```
┌───────────────────────────────────────────────────────────────┐
│ ShopStop     [ Search anything…  ⌘K ]        Sell  ✉  🔔  ◍   │
├───────────────────────────────────────────────────────────────┤
│  "Buy & sell anything — safely."   [Start selling] [Explore]   │  ← hero, gradient glass
│  Trust chips: ✔ Verified sellers  🛡 Fraud-protected  ⭐ Rated  │
├───────────────────────────────────────────────────────────────┤
│  Browse categories  [Electronics][Cars][Home][Fashion][…]      │  ← rounded pills, scroll
│  Trending near you   ▸  (card row, horizontal scroll)          │
│  Recently listed     ▸  (card row)                             │
│  From verified sellers ▸ (card row w/ ✔ badge)                 │
└───────────────────────────────────────────────────────────────┘
Card = image · title · ₹price(+Negotiable) · location · seller ✔ · ⭐score
```

### Search results (`/search`)
```
┌ Filters (sticky left / drawer on mobile) ┬ Results grid ─────────┐
│ Category ▾                               │ [sort: Relevance ▾]    │
│ Price [min]—[max]                        │ ▢ ▢ ▢                  │
│ Condition ▢New ▢Like-new ▢Used           │ ▢ ▢ ▢   (masonry cards)│
│ Location radius ●———○ 10km                │ ▢ ▢ ▢                  │
│ ✔ Verified sellers only                  │ [Load more / infinite] │
│ Seller rating ≥ ⭐4                        │                        │
└──────────────────────────────────────────┴───────────────────────┘
```

### Listing / product page (`/l/[id]`)
```
┌───────────────────────────────┬──────────────────────────────┐
│  Gallery (swipe, zoom)         │  Title                       │
│  ◧ ◧ ◧ ◧                       │  ₹ Price   [Negotiable]      │
│                                │  Condition · Location        │
│                                │  [ Make offer ] [ Chat ]     │
│                                │  [ ♡ Wishlist ] [ ⚑ Report ] │
│                                │ ┌ Seller trust panel ──────┐ │
│                                │ │ ◍ Name  ✔Verified  ⭐4.8  │ │
│                                │ │ Trust 92 · 120 orders    │ │
│                                │ │ Responds in ~1h · 2y     │ │
│                                │ └──────────────────────────┘ │
├───────────────────────────────┴──────────────────────────────┤
│ Specifications (from category attributes)                     │
│ Description                                                    │
│ Q&A · Reviews (verified-purchase, photos)                     │
│ Related in this category                                      │
└───────────────────────────────────────────────────────────────┘
```

### Sell wizard (`/sell`)
```
Step 1 Category → Step 2 Details(attrs) → Step 3 Photos → Step 4 Price/Location → Review
[ Save draft ]                                              [ Publish ▸ ]
(Publish triggers risk checks; result: live / limited / held-for-review)
```

### Chat (`/messages`)
```
┌ Threads ┬ Conversation ───────────────────────────┐
│ ◍ Priya │ Priya ✔ · online          [listing card]│
│ ◍ Rahul │ ────────────────────────────────────────│
│         │  buyer: is this available?               │
│         │  [ Offer: ₹8,000 ]  (accept/counter/no)  │
│         │  seller typing…            ✓✓ read       │
│         │ [＋img] [ type… ]                    [→]  │
└─────────┴──────────────────────────────────────────┘
```

### Admin moderation queue (`/admin/queue`)
```
Queue (sorted by risk ▾)
┌ risk ┬ type    ┬ subject          ┬ reason        ┬ actions ─────────┐
│  92  │ listing │ "iPhone 15 ₹5k"  │ dup+keyword   │ Approve Reject … │
│  74  │ user    │ @newseller       │ multi-account │ Suspend Ban  …   │
└──────┴─────────┴──────────────────┴───────────────┴──────────────────┘
Right panel: full context, risk-signal explanation, history, one-click actions (all audit-logged).
```

## Design system (tokens)

- **Type:** Inter / Geist variable; scale 12/14/16/18/24/32/48; generous line-height; tight tracking on headings.
- **Radius:** `sm 8` · `md 12` · `lg 16` · `xl 24` (cards). Pills fully rounded.
- **Spacing:** 4-pt base grid.
- **Elevation:** soft shadows; glass surfaces `backdrop-blur` + translucent bg for overlays/hero only (perf-guarded).
- **Color (semantic tokens, light/dark):**
  - `--bg`, `--surface`, `--surface-glass`, `--border`, `--text`, `--muted`
  - `--brand` (vibrant indigo→violet), `--accent` (teal/lime for playful highlights)
  - Trust semantics: `--verified` (blue), `--success` (green), `--warn` (amber), `--danger` (red)
- **Motion:** 150–250ms ease-out micro-interactions; respect `prefers-reduced-motion`; skeleton loaders over spinners.
- **Components:** shadcn/ui base (Radix a11y) + custom cards; command-palette search (⌘K).

## Accessibility & performance (targets in [15](15-testing-strategy.md))
- **WCAG 2.1 AA:** contrast ≥ 4.5:1, full keyboard nav, visible focus, semantic landmarks, alt text required on listing images, ARIA on interactive widgets.
- **Core Web Vitals:** LCP < 2.5s, INP < 200ms, CLS < 0.1 — via SSR/streaming, image optimization, code-split routes, edge caching.
- **SEO:** SSR listing/category pages, canonical URLs (`/l/[id]/[slug]`), OpenGraph, JSON-LD `Product`/`Offer`, sitemap, robots.
