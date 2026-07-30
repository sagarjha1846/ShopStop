import Link from 'next/link';
import type { Listing } from '@/lib/api';
import { formatMoney, mediaUrl } from '@/lib/format';

function isVerified(l: Listing): boolean {
  return !!(l.seller?.emailVerifiedAt || l.seller?.phoneVerifiedAt);
}

/**
 * Product tile. The image is the tile — it fills the top edge to edge, and the only
 * motion is a slow scale on hover, contained by the tile's own rounding. Text below
 * is a strict hierarchy: title, price, then one line of quiet context.
 */
export function ListingCard({ listing }: { listing: Listing }) {
  const img = mediaUrl(listing.media?.[0]?.storageKey);
  const verified = isVerified(listing);
  const context = [listing.negotiable ? 'Negotiable' : null, listing.locationText]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      href={`/l/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-lg bg-surface shadow-card transition-shadow duration-300 ease-out hover:shadow-lift"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-sunken">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          // A quiet well, not the words "No image" — absence shouldn't shout.
          <div aria-hidden className="h-full w-full bg-sunken" />
        )}
        {verified && (
          <span className="absolute left-3 top-3 rounded-pill bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-2 py-0.5 text-micro font-medium text-verified backdrop-blur">
            Verified seller
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        {/* Reserve both lines even for short titles so prices align across a row. */}
        <h3 className="line-clamp-2 min-h-[2.84em] text-footnote font-medium leading-snug">
          {listing.title}
        </h3>
        <p className="tabular text-body font-semibold">
          {formatMoney(listing.priceMinor, listing.currency)}
        </p>
        {context && <p className="mt-auto pt-1 text-caption text-faint">{context}</p>}
      </div>
    </Link>
  );
}
