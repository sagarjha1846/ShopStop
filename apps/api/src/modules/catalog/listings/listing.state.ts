import { ListingStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';

/** Seller-initiated listing actions (admin moderation transitions live in Phase 5). */
export type SellerListingAction = 'publish' | 'pause' | 'resume' | 'archive';

/**
 * Allowed seller transitions. `publish` resolves to ACTIVE or PENDING_REVIEW based
 * on the risk verdict (decided in the service, not here).
 */
const SELLER_TRANSITIONS: Record<SellerListingAction, { from: ListingStatus[]; to: ListingStatus }> = {
  publish: { from: [ListingStatus.DRAFT, ListingStatus.PAUSED], to: ListingStatus.ACTIVE },
  pause: { from: [ListingStatus.ACTIVE], to: ListingStatus.PAUSED },
  resume: { from: [ListingStatus.PAUSED], to: ListingStatus.ACTIVE },
  archive: {
    from: [ListingStatus.ACTIVE, ListingStatus.PAUSED, ListingStatus.DRAFT, ListingStatus.REJECTED],
    to: ListingStatus.ARCHIVED,
  },
};

export function assertSellerTransition(action: SellerListingAction, from: ListingStatus): ListingStatus {
  const rule = SELLER_TRANSITIONS[action];
  if (!rule.from.includes(from)) {
    throw AppError.illegalState(`Cannot ${action} a listing in ${from} state`);
  }
  return rule.to;
}

/** Statuses publicly visible in search/browse and on the product page. */
export const PUBLIC_LISTING_STATUSES: ListingStatus[] = [ListingStatus.ACTIVE, ListingStatus.SOLD];

export function isPubliclyVisible(status: ListingStatus): boolean {
  return PUBLIC_LISTING_STATUSES.includes(status);
}
