import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type Listing } from '@/lib/api';
import { formatMoney, mediaUrl } from '@/lib/format';
import { SellerTrustPanel } from '@/components/TrustPanel';
import { WishlistButton } from '@/components/WishlistButton';
import { Badge, LinkButton } from '@/components/ui';

async function getListing(id: string): Promise<Listing | null> {
  try {
    return await api<Listing>(`/listings/${id}`, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id).catch(() => null);
  if (!listing) return { title: 'Listing not found' };
  return {
    title: listing.title,
    description: listing.description?.slice(0, 160),
    openGraph: { title: listing.title, images: mediaUrl(listing.media?.[0]?.storageKey) ?? undefined },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();

  const seller = listing.seller;
  const badges: string[] = [];
  if (seller?.emailVerifiedAt) badges.push('EMAIL');
  if (seller?.phoneVerifiedAt) badges.push('PHONE');
  const attrs = Object.entries(listing.attributes ?? {});

  // JSON-LD for SEO (Product + Offer).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description,
    offers: {
      '@type': 'Offer',
      price: (listing.priceMinor / 100).toFixed(2),
      priceCurrency: listing.currency,
      availability: listing.status === 'ACTIVE' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Gallery + details */}
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2">
          {(listing.media?.length ? listing.media : [null]).map((m, i) => {
            const url = mediaUrl(m?.storageKey);
            return (
              <div
                key={m?.id ?? i}
                className={`overflow-hidden rounded-lg border bg-border ${i === 0 ? 'col-span-2 aspect-video' : 'aspect-square'}`}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={listing.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted">No image</div>
                )}
              </div>
            );
          })}
        </div>

        {attrs.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">Specifications</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {attrs.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b py-1">
                  <dt className="capitalize text-muted">{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section>
          <h2 className="mb-2 font-semibold">Description</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed">{listing.description}</p>
        </section>
      </div>

      {/* Sticky buy column */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-lg border bg-surface p-4">
          <h1 className="text-xl font-semibold">{listing.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-bold">{formatMoney(listing.priceMinor, listing.currency)}</span>
            {listing.negotiable && <Badge tone="muted">Negotiable</Badge>}
          </div>
          <div className="mt-1 text-sm text-muted">
            {listing.condition ?? '—'} · {listing.locationText ?? '—'}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <LinkButton href={`/login?next=/l/${listing.id}`}>Make an offer</LinkButton>
            <LinkButton href={`/login?next=/l/${listing.id}`} variant="outline">
              Chat with seller
            </LinkButton>
            <WishlistButton listingId={listing.id} />
          </div>
        </div>

        {seller?.profile && (
          <SellerTrustPanel
            displayName={seller.profile.displayName}
            handle={seller.profile.handle}
            trustScore={seller.trustScore?.score ?? 0}
            badges={badges}
            ratingAvg={0}
            ratingCount={0}
            completedSales={0}
            responseMins={null}
            memberSince={new Date().toISOString()}
          />
        )}
      </aside>
    </div>
  );
}
