import { Injectable } from '@nestjs/common';
import { CouponType, UserRole, type Coupon } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { CreateCouponDto } from './coupons.controller';

export interface AppliedCoupon {
  couponId: string;
  discountMinor: number;
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins create platform-wide coupons; other users create seller-scoped ones. */
  async create(userId: string, role: UserRole, dto: CreateCouponDto): Promise<Coupon> {
    const platformWide = role === UserRole.ADMIN && dto.platformWide === true;
    if (dto.type === CouponType.PERCENT && (dto.value < 1 || dto.value > 100)) {
      throw AppError.validation('Percent coupon value must be 1–100');
    }
    if (dto.value <= 0) throw AppError.validation('Coupon value must be positive');
    return this.prisma.coupon.create({
      data: {
        sellerId: platformWide ? null : userId,
        code: dto.code.trim().toUpperCase(),
        type: dto.type,
        value: dto.value,
        maxRedemptions: dto.maxRedemptions,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        isActive: true,
      },
    });
  }

  async listOwn(userId: string): Promise<Coupon[]> {
    return this.prisma.coupon.findMany({
      where: { OR: [{ sellerId: userId }, { sellerId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Validate a coupon against a listing + subtotal and atomically reserve a
   * redemption (guarded by maxRedemptions to prevent oversell under concurrency).
   * Returns the discount to apply. Caller stores couponId on the order.
   */
  async validateAndReserve(code: string, listingSellerId: string, subtotalMinor: number): Promise<AppliedCoupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!coupon || !coupon.isActive) throw AppError.validation('Invalid coupon code');

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) throw AppError.validation('Coupon is not active yet');
    if (coupon.endsAt && coupon.endsAt < now) throw AppError.validation('Coupon has expired');
    // Seller-scoped coupons only apply to that seller's listings.
    if (coupon.sellerId && coupon.sellerId !== listingSellerId) {
      throw AppError.validation('Coupon does not apply to this listing');
    }

    const discountMinor = this.computeDiscount(coupon, subtotalMinor);

    // Atomic reservation: only increments if under the limit (or no limit).
    if (coupon.maxRedemptions != null) {
      const res = await this.prisma.coupon.updateMany({
        where: { id: coupon.id, redeemedCount: { lt: coupon.maxRedemptions } },
        data: { redeemedCount: { increment: 1 } },
      });
      if (res.count === 0) throw AppError.conflict('Coupon redemption limit reached');
    } else {
      await this.prisma.coupon.update({ where: { id: coupon.id }, data: { redeemedCount: { increment: 1 } } });
    }

    return { couponId: coupon.id, discountMinor };
  }

  /** Give back a reserved redemption when an order is cancelled/rejected before use. */
  async release(couponId: string): Promise<void> {
    await this.prisma.coupon.updateMany({
      where: { id: couponId, redeemedCount: { gt: 0 } },
      data: { redeemedCount: { decrement: 1 } },
    });
  }

  private computeDiscount(coupon: Coupon, subtotalMinor: number): number {
    const raw =
      coupon.type === CouponType.PERCENT
        ? Math.round((subtotalMinor * coupon.value) / 100)
        : coupon.value;
    // Discount can never exceed the subtotal.
    return Math.min(raw, subtotalMinor);
  }
}
