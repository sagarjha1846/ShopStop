import Link from 'next/link';
import { api, type Category, type Listing, type Page } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';
import { LinkButton, EmptyState } from '@/components/ui';

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
    safe(api<Page<Listing>>('/listings?limit=24', { revalidate: 30 }), {
      items: [],
      nextCursor: null,
    }),
  ]);

  return (
    <>
      {/*
        The hero is a statement, not a box. No card, no gradient, no chips — just the
        claim at display size on the open canvas, which is the whole argument of this
        design language: if the sentence is good, it doesn't need a container.
      */}
      <section className="animate-rise-in py-16 text-center sm:py-24">
        <h1 className="mx-auto max-w-3xl text-display font-semibold sm:text-hero">
          Buy and sell anything.
          <br />
          <span className="text-muted">Know exactly who you&rsquo;re dealing with.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-lg text-lead text-muted">
          Every seller carries a trust score built from verified identity, real sales, and resolved
          disputes. You can see how it was calculated.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <LinkButton href="/search" size="lg">
            Browse listings
          </LinkButton>
          <LinkButton href="/sell" variant="secondary" size="lg">
            Start selling
          </LinkButton>
        </div>
      </section>

      {categories.length > 0 && (
        <section className="pb-4">
          <h2 className="sr-only">Categories</h2>
          {/* Scrolls rather than wraps, so the row stays one clean line on any width. */}
          <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/search?categoryId=${c.id}`}
                className="shrink-0 snap-start rounded-pill bg-surface px-4 py-2 text-caption font-medium shadow-card transition-colors duration-200 hover:text-accent"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="py-10">
        <div className="mb-6 flex items-end justify-between gap-3">
          <h2 className="text-title font-semibold">Recently listed</h2>
          <Link
            href="/search"
            className="text-caption text-link transition-opacity duration-200 hover:opacity-70"
          >
            See all
          </Link>
        </div>

        {listings.items.length === 0 ? (
          <EmptyState
            title="Nothing listed yet"
            body="The first listing on ShopStop could be yours. It takes about a minute."
            action={<LinkButton href="/sell">Start selling</LinkButton>}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {listings.items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
