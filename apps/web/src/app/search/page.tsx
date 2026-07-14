import { api, type Listing, type Page } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';

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
    const res = await safe(api<{ items: SearchItem[] }>(`/search?${params}`, { cache: 'no-store' }), { items: [] });
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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {q ? `Results for “${q}”` : categoryId ? 'Category' : 'All listings'}
        <span className="ml-2 text-sm font-normal text-muted">{listings.length} items</span>
      </h1>
      {listings.length === 0 ? (
        <div className="rounded-lg border bg-surface p-8 text-center text-muted">No matching listings.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
