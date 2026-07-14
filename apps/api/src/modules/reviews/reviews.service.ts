import { Injectable } from '@nestjs/common';
import { OrderStatus, type Review } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { CreateReviewDto } from './dto/review.dto';

const REVIEWABLE_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.RETURNED,
  OrderStatus.REFUNDED,
];

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A party reviews their counterparty for a completed order (verified purchase). */
  async create(authorId: string, dto: CreateReviewDto): Promise<Review> {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw AppError.notFound('Order');
    if (order.buyerId !== authorId && order.sellerId !== authorId) {
      throw AppError.forbidden('You are not a party to this order');
    }
    if (!REVIEWABLE_STATUSES.includes(order.status)) {
      throw AppError.illegalState('You can only review a completed order');
    }
    const subjectId = authorId === order.buyerId ? order.sellerId : order.buyerId;

    const existing = await this.prisma.review.findUnique({
      where: { orderId_authorId: { orderId: order.id, authorId } },
    });
    if (existing) throw AppError.conflict('You have already reviewed this order');

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          orderId: order.id,
          listingId: order.listingId,
          authorId,
          subjectId,
          rating: dto.rating,
          body: dto.body?.trim(),
          mediaKeys: dto.mediaKeys ?? [],
          verified: true,
        },
      });

      // Recompute the subject's denormalized reputation counters (docs/05).
      const agg = await tx.review.aggregate({
        where: { subjectId },
        _avg: { rating: true },
        _count: true,
      });
      await tx.profile.updateMany({
        where: { userId: subjectId },
        data: {
          ratingAvg: Number((agg._avg.rating ?? 0).toFixed(2)),
          ratingCount: agg._count,
        },
      });
      return review;
    });
  }

  async listForUser(userId: string): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: { subjectId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { profile: { select: { handle: true, displayName: true, avatarUrl: true } } } },
      },
      take: 50,
    });
  }
}
