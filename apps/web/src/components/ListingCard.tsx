import Link from 'next/link';
import type { Listing } from '@/lib/api';
import { formatMoney, mediaUrl } from '@/lib/format';
import { Badge } from './ui';

function isVerified(l: Listing): boolean {
  return !!(l.seller?.emailVerifiedAt || l.seller?.phoneVerifiedAt);
}

export function ListingCard({ listing }: { listing: Listing }) {
  const img = mediaUrl(listing.media?.[0]?.storageKey);
  return (
    <Link
      href={`/l/${listing.id}`}
      className="group animate-fade-in overflow-hidden rounded-lg border bg-surface transition hover:shadow-md"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-border">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={listing.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">No image</div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="line-clamp-1 font-medium">{listing.title}</div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{formatMoney(listing.priceMinor, listing.currency)}</span>
          {listing.negotiable && <span className="text-xs text-muted">Negotiable</span>}
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="line-clamp-1">{listing.locationText ?? '—'}</span>
          {isVerified(listing) && <Badge tone="verified">✓ Verified</Badge>}
        </div>
      </div>
    </Link>
  );
}
