import { Injectable, Logger } from '@nestjs/common';
import { DisputeStatus, OrderStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface TrustFactors {
  emailVerified: number;
  phoneVerified: number;
  identityVerified: number;
  businessVerified: number;
  completedSales: number;
  rating: number;
  tenure: number;
  lostDisputes: number;
  fraud: number;
}

/**
 * Computes the explainable trust score (0–100) from behavioral + verification
 * signals (docs/10). Stored on TrustScore with a factor breakdown so admins/users
 * see *why*. Recomputed on verification, reviews, completed orders, and fraud
 * outcomes. (A BullMQ reputation worker can own this at scale; called inline here.)
 */
@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recompute(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { verification: true, sellerVerif: true, profile: true, trustScore: true },
    });
    if (!user) return;

    const [completedSales, lostDisputes] = await Promise.all([
      this.prisma.order.count({ where: { sellerId: userId, status: OrderStatus.DELIVERED } }),
      this.prisma.dispute.count({
        where: {
          status: { in: [DisputeStatus.RESOLVED_REFUND, DisputeStatus.RESOLVED_PARTIAL] },
          order: { sellerId: userId },
        },
      }),
    ]);

    const ratingAvg = user.profile?.ratingAvg ?? 0;
    const ratingCount = user.profile?.ratingCount ?? 0;
    const tenureDays = (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
    const fraudScore = user.trustScore?.fraudScore ?? 0;

    const factors: TrustFactors = {
      emailVerified: user.emailVerifiedAt ? 15 : 0,
      phoneVerified: user.phoneVerifiedAt ? 15 : 0,
      identityVerified: user.verification?.status === 'VERIFIED' ? 15 : 0,
      businessVerified: user.sellerVerif?.status === 'VERIFIED' ? 10 : 0,
      // up to +15 for volume (diminishing), only if it has real reviews behind it
      completedSales: Math.min(15, Math.round(Math.log10(completedSales + 1) * 12)),
      // up to +25, weighted down when there are few reviews
      rating: ratingCount > 0 ? Math.round((ratingAvg / 5) * 25 * Math.min(1, ratingCount / 5)) : 0,
      tenure: Math.min(5, Math.round(tenureDays / 30)),
      lostDisputes: -Math.min(20, lostDisputes * 10),
      fraud: -Math.round(fraudScore / 2),
    };

    const raw = Object.values(factors).reduce((a, b) => a + b, 0);
    const score = Math.max(0, Math.min(100, raw));

    await this.prisma.trustScore.upsert({
      where: { userId },
      create: { userId, score, factors: factors as unknown as Prisma.InputJsonValue, computedAt: new Date() },
      update: { score, factors: factors as unknown as Prisma.InputJsonValue, computedAt: new Date() },
    });
  }

  /** Fire-and-forget recompute (never fails the triggering request). */
  recomputeAsync(userId: string): void {
    void this.recompute(userId).catch((e) => this.logger.warn(`trust recompute failed: ${String(e)}`));
  }
}
