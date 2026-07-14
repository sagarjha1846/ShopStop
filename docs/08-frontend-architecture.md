# 08 — Frontend Architecture

## Stack
- **Next.js (App Router)** + **TypeScript** — SSR/streaming for SEO-critical pages (home, category, listing, profile), client interactivity where it matters (chat, sell wizard, dashboards).
- **Tailwind CSS** + **shadcn/ui** (Radix primitives → accessible by default) + custom design system ([04](04-ia-and-wireframes.md)).
- **TanStack Query** for server state (caching, retries, optimistic updates); **Zustand** for small client UI state (theme, command palette, chat draft). No heavyweight global store.
- **React Hook Form + Zod** for forms; the **same Zod schemas** are shared with the API contract so client/server validation agree.
- **Socket.IO client** for realtime (chat, presence, notifications).

## Rendering strategy (per route)
| Route | Strategy | Why |
|---|---|---|
| `/` home | SSR + streamed sections | SEO + fast first paint, personalized rows stream in |
| `/search` | Client-fetched (SSR shell) | interactive facets, cursor pagination |
| `/l/[id]/[slug]` | SSR + ISR-ish revalidate | SEO, OpenGraph/JSON-LD, cache-friendly |
| `/c/[category]` | SSR + cache | SEO, stable content |
| `/u/[handle]` | SSR | shareable trust profile |
| `/sell`, `/dashboard/*`, `/messages` | Client (auth-gated) | app-like, no SEO need |
| `/admin/*` | Client (RBAC-gated) | internal tool |

## Project structure
```
apps/web (Next.js App Router)
├── app/
│   ├── (marketing)/           home, category, listing, profile  (SSR, public)
│   ├── (app)/                 sell, dashboard, messages, orders  (auth)
│   ├── admin/                 admin console (RBAC)
│   └── api/                   BFF route handlers (thin; proxy/session helpers)
├── components/                design-system + feature components
├── features/                  listing, search, chat, orders, trust (co-located)
├── lib/                       api client, auth, sockets, query client, zod schemas
├── hooks/
└── styles/                    tailwind + tokens (light/dark)
```

## Data & auth
- **API client:** typed fetch wrapper (generated from OpenAPI or shared Zod) with automatic access-token attach + silent refresh on 401. Access token in memory; refresh token in httpOnly cookie (never touched by JS).
- **BFF layer (thin):** a few Next route handlers keep secrets server-side and set cookies; the browser never sees provider secrets.
- **Optimistic UX:** offers, wishlist, message send update instantly and reconcile with server via TanStack Query.

## Trust surfaced in the UI
The **trust panel** (score, badges, member-since, completed orders, response time, rating) is a shared component rendered on cards, listing pages, chat headers, and checkout — trust is visible at every decision point, not buried in a profile tab.

## Performance (Core Web Vitals targets)
- **LCP < 2.5s:** SSR/stream above-the-fold, `next/image` with S3+CloudFront + AVIF/WebP, priority hints on hero/gallery.
- **INP < 200ms:** code-split routes, defer non-critical JS, virtualized long lists (search results, chat), avoid layout thrash.
- **CLS < 0.1:** reserved image/media dimensions, skeletons, no injected layout shifts.
- Edge-cache public pages; prefetch on hover/viewport; route-level suspense boundaries.

## Accessibility (WCAG 2.1 AA)
- Radix/shadcn semantics, keyboard-navigable everything, visible focus rings, ≥4.5:1 contrast in both themes, `prefers-reduced-motion` honored, required alt text on listing images, ARIA live regions for chat/notifications.

## Theming
- Light + dark via CSS variables (semantic tokens in [04](04-ia-and-wireframes.md)); system-preference default with manual toggle persisted; glassmorphism limited to hero/overlays and disabled under reduced-transparency/perf constraints.

## SEO
- SSR for public routes, canonical URLs, `next-sitemap`, `robots.txt`, JSON-LD `Product`/`Offer`/`AggregateRating` on listings, OpenGraph/Twitter cards generated per listing.

## Error & loading UX
- Route-level `loading.tsx`/`error.tsx`, skeletons over spinners, toasts for mutations, retry affordances; a global error boundary reports to the monitoring stack ([14](14-monitoring-and-logging.md)) with the `requestId` from the API.

## Mobile / future RN
The web app is fully responsive and PWA-ready. Because all data flows through the versioned REST API + Socket.IO, a **React Native** app reuses the same contracts, auth flow, and Zod schemas — **no backend change** required ([03](03-features.md)).
