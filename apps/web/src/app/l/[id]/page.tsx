import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type Listing } from '@/lib/api';
import { formatMoney, mediaUrl } from '@/lib/format';
import { SellerTrustPanel } from '@/components/TrustPanel';
import { WishlistButton } from '@/components/WishlistButton';
import { Badge, Card, LinkButton, Divider } from '@/components/ui';

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
    openGraph: {
      title: listing.title,
      images: mediaUrl(listing.media?.[0]?.storageKey) ?? undefined,
    },
  };
}

const CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  GOOD: 'Good',
  FAIR: 'Fair',
  FOR_PARTS: 'For parts',
};

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();

  const seller = listing.seller;
  const badges: string[] = [];
  if (seller?.emailVerifiedAt) badges.push('EMAIL');
  if (seller?.phoneVerifiedAt) badges.push('PHONE');
  const attrs = Object.entries(listing.attributes ?? {});
  const media = listing.media?.length ? listing.media : [];
  const soldOut = listing.status !== 'ACTIVE';
  // Only surface scarcity when it's genuinely scarce — a countdown on every listing
  // is pressure, not information.
  const lowStock = !soldOut && listing.quantity > 0 && listing.quantity <= 5;

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
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    },
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Gallery + details */}
      <div>
        <div className="grid grid-cols-2 gap-3">
          {media.length > 0 ? (
            media.map((m, i) => {
              const url = mediaUrl(m.storageKey);
              return (
                <div
                  key={m.id ?? i}
                  className={`overflow-hidden rounded-lg bg-sunken ${
                    i === 0 ? 'col-span-2 aspect-video' : 'aspect-square'
                  }`}
                >
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
              );
            })
          ) : (
            <div aria-hidden className="col-span-2 aspect-video rounded-lg bg-sunken" />
          )}
        </div>

        <section className="mt-12">
          <h2 className="mb-3 text-headline font-semibold">Description</h2>
          <p className="max-w-prose whitespace-pre-line text-footnote leading-relaxed text-muted">
            {listing.description}
          </p>
        </section>

        {attrs.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-headline font-semibold">Specifications</h2>
            {/* Two even columns keep each value beside its label instead of flung to
                the far edge of the measure. */}
            <dl className="max-w-prose">
              {attrs.map(([k, v], i) => (
                <div key={k}>
                  {i > 0 && <Divider />}
                  <div className="grid grid-cols-2 gap-6 py-2.5">
                    <dt className="text-caption capitalize text-muted">{k}</dt>
                    <dd className="text-caption">{String(v)}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {/* Buy column: follows the reader down the gallery. */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card className="p-5">
          <h1 className="text-title font-semibold">{listing.title}</h1>

          <p className="tabular mt-3 text-title font-semibold">
            {formatMoney(listing.priceMinor, listing.currency)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {listing.condition && (
              <span className="text-caption text-muted">
                {CONDITION_LABEL[listing.condition] ?? listing.condition}
              </span>
            )}
            {listing.locationText && (
              <span className="text-caption text-muted">· {listing.locationText}</span>
            )}
            {listing.negotiable && <Badge tone="muted">Negotiable</Badge>}
          </div>

          {soldOut ? (
            <p className="mt-4 text-caption text-muted">This listing is no longer available.</p>
          ) : (
            lowStock && (
              <p className="mt-4 text-caption text-warn">
                {listing.quantity === 1 ? 'Last one left' : `Only ${listing.quantity} left`}
              </p>
            )
          )}

          <div className="mt-5 flex flex-col gap-2">
            <LinkButton href={`/login?next=/l/${listing.id}`} size="lg" aria-disabled={soldOut}>
              {soldOut ? 'Sold out' : 'Buy now'}
            </LinkButton>
            {!soldOut && (
              <LinkButton href={`/login?next=/l/${listing.id}`} variant="secondary">
                Make an offer
              </LinkButton>
            )}
            <WishlistButton listingId={listing.id} />
          </div>
        </Card>

        {seller?.profile && (
          <SellerTrustPanel
            displayName={seller.profile.displayName}
            handle={seller.profile.handle}
            trustScore={seller.trustScore?.score ?? 0}
            trustFactors={seller.trustScore?.factors}
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
