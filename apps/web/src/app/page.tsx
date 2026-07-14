import Link from 'next/link';
import { api, type Category, type Listing, type Page } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';
import { LinkButton } from '@/components/ui';

// Revalidate the home feed periodically; it is public and cache-friendly.
export const revalidate = 30;

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const [categories, listings] = await Promise.all([
    safe(api<Category[]>('/categories', { revalidate: 300 }), []),
    safe(api<Page<Listing>>('/listings?limit=24', { revalidate: 30 }), { items: [], nextCursor: null }),
  ]);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="rounded-xl border bg-gradient-to-br from-brand/10 to-accent/10 p-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Buy &amp; sell anything — <span className="text-brand">safely</span>.
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          A peer-to-peer marketplace where every deal is backed by identity verification, fraud
          detection, and transparent dispute resolution.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border bg-surface px-3 py-1">✓ Verified sellers</span>
          <span className="rounded-full border bg-surface px-3 py-1">🛡 Fraud-protected</span>
          <span className="rounded-full border bg-surface px-3 py-1">★ Rated &amp; reviewed</span>
        </div>
        <div className="mt-5 flex gap-2">
          <LinkButton href="/sell">Start selling</LinkButton>
          <LinkButton href="/search" variant="outline">
            Explore
          </LinkButton>
        </div>
      </section>

      {/* Categories */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Browse categories</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/search?categoryId=${c.id}`}
              className="rounded-full border bg-surface px-4 py-1.5 text-sm hover:border-brand"
            >
              {c.name}
            </Link>
          ))}
          {categories.length === 0 && <p className="text-muted">Categories unavailable.</p>}
        </div>
      </section>

      {/* Recently listed */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recently listed</h2>
        {listings.items.length === 0 ? (
          <div className="rounded-lg border bg-surface p-8 text-center text-muted">
            No live listings yet. <Link className="text-brand underline" href="/sell">Be the first to sell.</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {listings.items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
