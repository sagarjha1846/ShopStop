import { api, type Listing, type Page } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState, LinkButton } from '@/components/ui';

export const metadata = { title: 'Search' };

interface SearchItem {
  id: string;
  title: string;
  slug: string;
  priceMinor: number;
  currency: string;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const categoryId = sp.categoryId;

  let listings: Listing[] = [];
  if (q) {
    const params = new URLSearchParams({ q });
    if (categoryId) params.set('categoryId', categoryId);
    const res = await safe(
      api<{ items: SearchItem[] }>(`/search?${params}`, { cache: 'no-store' }),
      { items: [] },
    );
    listings = res.items.map((i) => ({ ...i, status: 'ACTIVE' }) as Listing);
  } else {
    const params = new URLSearchParams({ limit: '24' });
    if (categoryId) params.set('categoryId', categoryId);
    const res = await safe(api<Page<Listing>>(`/listings?${params}`, { cache: 'no-store' }), {
      items: [],
      nextCursor: null,
    });
    listings = res.items;
  }

  return (
    <div className="py-4">
      <header className="mb-6">
        <h1 className="text-title font-semibold">
          {q ? `Results for “${q}”` : categoryId ? 'Category' : 'All listings'}
        </h1>
        <p className="mt-1 text-caption text-muted">
          {listings.length === 1 ? '1 listing' : `${listings.length} listings`}
        </p>
      </header>

      {listings.length === 0 ? (
        <EmptyState
          title={q ? `No listings match “${q}”` : 'Nothing here yet'}
          body={
            q
              ? 'Try a shorter search, or browse everything that is currently for sale.'
              : 'There are no live listings in this category right now.'
          }
          action={<LinkButton href="/search">Browse all listings</LinkButton>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
