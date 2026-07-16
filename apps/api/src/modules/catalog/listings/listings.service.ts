import { Injectable } from '@nestjs/common';
import { ListingStatus, type Listing, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppError } from '../../../common/errors/app-error';
import { CategoriesService } from '../categories/categories.service';
import { validateAttributes } from '../attribute-validator';
import { RiskService } from '../../trust/risk.service';
import { MediaScanProducer } from '../../../jobs/media-scan.producer';
import { assertSellerTransition, isPubliclyVisible, type SellerListingAction } from './listing.state';
import type { CreateListingDto, UpdateListingDto } from './dto/listing.dto';

export interface ListingQuery {
  cursor?: string;
  limit?: number;
  categoryId?: string;
  sellerId?: string;
  sort?: 'recent' | 'price_asc' | 'price_desc';
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly risk: RiskService,
    private readonly mediaScan: MediaScanProducer,
  ) {}

  async create(sellerId: string, dto: CreateListingDto): Promise<Listing> {
    const category = await this.categories.findByIdOrThrow(dto.categoryId);
    const attributes = validateAttributes(this.categories.getFields(category), dto.attributes);

    const listing = await this.prisma.listing.create({
      data: {
        sellerId,
        categoryId: category.id,
        type: dto.type ?? 'PHYSICAL',
        status: ListingStatus.DRAFT,
        title: dto.title.trim(),
        slug: this.slugify(dto.title),
        description: dto.description,
        condition: dto.condition,
        priceMinor: dto.priceMinor,
        currency: dto.currency ?? 'INR',
        negotiable: dto.negotiable ?? false,
        quantity: dto.quantity ?? 1,
        attributes: attributes as Prisma.InputJsonValue,
        tags: this.normalizeTags(dto.tags),
        locationText: dto.locationText,
        lat: dto.lat,
        lng: dto.lng,
      },
    });

    await this.attachMedia(listing.id, dto.mediaKeys);

    if (dto.publish) return this.publish(sellerId, listing.id);
    return this.withMedia(listing.id);
  }

  /** Publish runs the risk engine and gates ACTIVE vs PENDING_REVIEW (docs/09 #3). */
  async publish(sellerId: string, listingId: string): Promise<Listing> {
    const listing = await this.ownedOrThrow(sellerId, listingId);
    const target = assertSellerTransition('publish', listing.status);

    const seller = await this.prisma.user.findUniqueOrThrow({
      where: { id: sellerId },
      include: { trustScore: true },
    });
    const verdict = await this.risk.assessListing({
      sellerId,
      title: listing.title,
      description: listing.description,
      priceMinor: listing.priceMinor,
      sellerTrustScore: seller.trustScore?.score ?? 0,
      sellerVerified: !!seller.emailVerifiedAt || !!seller.phoneVerifiedAt,
    });

    const status = verdict.band === 'low' ? target : ListingStatus.PENDING_REVIEW;
    await this.risk.recordListingFraudEvent(listing.id, sellerId, verdict);

    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status, publishedAt: status === ListingStatus.ACTIVE ? new Date() : null },
    });
    return this.withMedia(listing.id);
  }

  async transition(sellerId: string, listingId: string, action: SellerListingAction): Promise<Listing> {
    if (action === 'publish') return this.publish(sellerId, listingId);
    const listing = await this.ownedOrThrow(sellerId, listingId);
    const target = assertSellerTransition(action, listing.status);
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: target,
        publishedAt: target === ListingStatus.ACTIVE ? (listing.publishedAt ?? new Date()) : listing.publishedAt,
      },
    });
    return this.withMedia(listing.id);
  }

  async update(sellerId: string, listingId: string, dto: UpdateListingDto): Promise<Listing> {
    const listing = await this.ownedOrThrow(sellerId, listingId);
    let attributes: Prisma.InputJsonValue | undefined;
    if (dto.attributes) {
      const category = await this.categories.findByIdOrThrow(listing.categoryId);
      attributes = validateAttributes(this.categories.getFields(category), dto.attributes) as Prisma.InputJsonValue;
    }
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: {
        title: dto.title?.trim(),
        slug: dto.title ? this.slugify(dto.title) : undefined,
        description: dto.description,
        condition: dto.condition,
        priceMinor: dto.priceMinor,
        negotiable: dto.negotiable,
        quantity: dto.quantity,
        attributes,
        tags: dto.tags ? this.normalizeTags(dto.tags) : undefined,
        locationText: dto.locationText,
      },
    });
    return this.withMedia(listing.id);
  }

  async duplicate(sellerId: string, listingId: string): Promise<Listing> {
    const src = await this.ownedOrThrow(sellerId, listingId);
    const copy = await this.prisma.listing.create({
      data: {
        sellerId,
        categoryId: src.categoryId,
        type: src.type,
        status: ListingStatus.DRAFT,
        title: `${src.title} (copy)`,
        slug: this.slugify(`${src.title}-copy`),
        description: src.description,
        condition: src.condition,
        priceMinor: src.priceMinor,
        currency: src.currency,
        negotiable: src.negotiable,
        quantity: src.quantity,
        attributes: src.attributes as Prisma.InputJsonValue,
        tags: src.tags,
        locationText: src.locationText,
        lat: src.lat,
        lng: src.lng,
      },
    });
    return this.withMedia(copy.id);
  }

  // ---- variants (e.g. "Red / 128GB") ----

  async addVariant(
    sellerId: string,
    listingId: string,
    dto: { name: string; attributes?: Record<string, unknown>; priceMinor?: number; quantity?: number },
  ): Promise<unknown> {
    await this.ownedOrThrow(sellerId, listingId);
    return this.prisma.listingVariant.create({
      data: {
        listingId,
        name: dto.name.trim().slice(0, 80),
        attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
        priceMinor: dto.priceMinor,
        quantity: dto.quantity ?? 1,
      },
    });
  }

  async listVariants(listingId: string): Promise<unknown[]> {
    return this.prisma.listingVariant.findMany({ where: { listingId }, orderBy: { name: 'asc' } });
  }

  async updateVariant(
    sellerId: string,
    listingId: string,
    variantId: string,
    dto: { name?: string; attributes?: Record<string, unknown>; priceMinor?: number; quantity?: number },
  ): Promise<unknown> {
    await this.ownedOrThrow(sellerId, listingId);
    const variant = await this.prisma.listingVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.listingId !== listingId) throw AppError.notFound('Variant');
    return this.prisma.listingVariant.update({
      where: { id: variantId },
      data: {
        name: dto.name?.trim(),
        attributes: dto.attributes ? (dto.attributes as Prisma.InputJsonValue) : undefined,
        priceMinor: dto.priceMinor,
        quantity: dto.quantity,
      },
    });
  }

  async deleteVariant(sellerId: string, listingId: string, variantId: string): Promise<void> {
    await this.ownedOrThrow(sellerId, listingId);
    const res = await this.prisma.listingVariant.deleteMany({ where: { id: variantId, listingId } });
    if (res.count === 0) throw AppError.notFound('Variant');
  }

  async softDelete(sellerId: string, listingId: string): Promise<void> {
    const listing = await this.ownedOrThrow(sellerId, listingId);
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { deletedAt: new Date(), status: ListingStatus.ARCHIVED },
    });
  }

  /** Public detail view: visible statuses to anyone; owner sees any own listing. */
  async getPublic(listingId: string, viewerId?: string): Promise<Listing> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      include: {
        media: { where: { scanStatus: { not: 'REJECTED' } }, orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { name: 'asc' } },
        seller: { select: { profile: true, trustScore: true, emailVerifiedAt: true, phoneVerifiedAt: true } },
        category: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!listing) throw AppError.notFound('Listing');
    if (!isPubliclyVisible(listing.status) && listing.sellerId !== viewerId) {
      throw AppError.notFound('Listing');
    }
    // Fire-and-forget view count (best effort; not on the read's critical path invariant).
    void this.prisma.listing
      .update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
    return listing;
  }

  /** Browse/list, cursor-paginated. Public browse restricts to visible statuses. */
  async list(query: ListingQuery, viewerId?: string): Promise<{ items: Listing[]; nextCursor: string | null }> {
    const limit = Math.min(query.limit ?? 20, 50);
    const where: Prisma.ListingWhereInput = { deletedAt: null };

    if (query.sellerId) {
      where.sellerId = query.sellerId;
      // Only owners see their own non-public listings.
      if (query.sellerId !== viewerId) where.status = { in: ['ACTIVE', 'SOLD'] };
    } else {
      where.status = ListingStatus.ACTIVE;
    }
    if (query.categoryId) where.categoryId = query.categoryId;

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      query.sort === 'price_asc'
        ? { priceMinor: 'asc' }
        : query.sort === 'price_desc'
          ? { priceMinor: 'desc' }
          : { createdAt: 'desc' };

    const mediaInclude = { media: { where: { scanStatus: { not: 'REJECTED' } as const }, orderBy: { sortOrder: 'asc' as const }, take: 1 } };

    // Sponsored placement: on page 1 of the default browse feed, currently-active
    // boosts appear on top. Only active boosts qualify (boostedUntil > now), so
    // expired boosts never retain priority — no cleanup job required.
    let boosted: Listing[] = [];
    const boostedFeed = !query.cursor && !query.sort && !query.sellerId;
    if (boostedFeed) {
      boosted = await this.prisma.listing.findMany({
        where: { ...where, boostedUntil: { gt: new Date() } },
        orderBy: { boostedUntil: 'desc' },
        take: 4,
        include: mediaInclude,
      });
    }
    const boostedIds = new Set(boosted.map((b) => b.id));

    const rows = await this.prisma.listing.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: mediaInclude,
    });

    const hasMore = rows.length > limit;
    const regular = hasMore ? rows.slice(0, limit) : rows;
    // nextCursor tracks the recency list (not the boosted prepend) so paging is stable.
    const nextCursor = hasMore ? (regular[regular.length - 1]?.id ?? null) : null;
    const items = [...boosted, ...regular.filter((r) => !boostedIds.has(r.id))].slice(0, limit);
    return { items, nextCursor };
  }

  /** Feature a listing to the top of browse for N days (owner only). In prod this
   *  is gated behind a boost payment (Phase 2); here it sets the window directly. */
  async boost(sellerId: string, listingId: string, days: number): Promise<Listing> {
    await this.ownedOrThrow(sellerId, listingId);
    const until = new Date(Date.now() + Math.min(Math.max(days, 1), 30) * 86_400_000);
    await this.prisma.listing.update({ where: { id: listingId }, data: { boostedUntil: until } });
    return this.withMedia(listingId);
  }

  // ---- helpers ----

  private async ownedOrThrow(sellerId: string, listingId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, deletedAt: null } });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.sellerId !== sellerId) throw AppError.forbidden('You do not own this listing');
    return listing;
  }

  private async withMedia(listingId: string): Promise<Listing> {
    return this.prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  private async attachMedia(listingId: string, mediaKeys?: string[]): Promise<void> {
    if (!mediaKeys?.length) return;
    // Create each media row PENDING and enqueue an async scan (docs/09 #8).
    for (const [i, storageKey] of mediaKeys.slice(0, 12).entries()) {
      const media = await this.prisma.media.create({ data: { listingId, storageKey, sortOrder: i } });
      await this.mediaScan.enqueue({ mediaId: media.id, storageKey }).catch(() => undefined);
    }
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags) return [];
    return Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
  }

  private slugify(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return `${base || 'listing'}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
