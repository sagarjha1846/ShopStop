import { Injectable } from '@nestjs/common';
import type { Listing } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async add(userId: string, listingId: string): Promise<{ wishlisted: true }> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: { id: true },
    });
    if (!listing) throw AppError.notFound('Listing');
    // Idempotent: unique (userId, listingId) — ignore duplicates.
    await this.prisma.wishlistItem
      .create({ data: { userId, listingId } })
      .catch(() => undefined);
    return { wishlisted: true };
  }

  async remove(userId: string, listingId: string): Promise<{ wishlisted: false }> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId, listingId } });
    return { wishlisted: false };
  }

  async has(userId: string, listingId: string): Promise<{ wishlisted: boolean }> {
    const item = await this.prisma.wishlistItem.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });
    return { wishlisted: !!item };
  }

  async list(userId: string): Promise<Listing[]> {
    const items = await this.prisma.wishlistItem.findMany({
      where: { userId, listing: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: { listing: { include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
      take: 100,
    });
    return items.map((i) => i.listing);
  }
}
