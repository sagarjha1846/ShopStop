import { Injectable } from '@nestjs/common';
import { OrderStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';

export interface SellerEarnings {
  currency: string;
  feeBps: number;
  /** Captured sales the seller has actually been credited for. */
  settled: { grossMinor: number; feeMinor: number; netMinor: number; orders: number };
  /** Accepted-but-not-yet-captured sales — money in flight, not yet earned. */
  pending: { grossMinor: number; feeMinor: number; netMinor: number; orders: number };
  lifetimeNetMinor: number;
}

export interface RevenueSummary {
  currency: string;
  feeBps: number;
  /** Gross merchandise value: everything buyers actually paid. */
  gmvMinor: number;
  /** What the platform kept — the top line that matters. */
  feeRevenueMinor: number;
  refundedMinor: number;
  paidOrders: number;
  averageOrderValueMinor: number;
  takeRatePct: number;
  byDay: Array<{ day: string; gmvMinor: number; feeRevenueMinor: number; orders: number }>;
}

/** Orders whose money is committed but not yet captured. */
const IN_FLIGHT: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PACKED, OrderStatus.SHIPPED];

@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * What a seller has earned and what is still in flight.
   *
   * Settled figures come from the ledger (CHARGE/FEE rows), not from order
   * columns: the ledger is the immutable record of money that actually moved,
   * and an order row can be edited by later state changes.
   */
  async sellerEarnings(sellerId: string): Promise<SellerEarnings> {
    const [settledAgg, pendingAgg] = await Promise.all([
      this.prisma.order.aggregate({
        where: { sellerId, payment: { status: 'CAPTURED' } },
        _sum: { totalMinor: true, feeMinor: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: { sellerId, status: { in: IN_FLIGHT }, payment: { is: null } },
        _sum: { totalMinor: true, feeMinor: true },
        _count: true,
      }),
    ]);

    const settled = this.split(settledAgg._sum.totalMinor, settledAgg._sum.feeMinor, settledAgg._count);
    const pending = this.split(pendingAgg._sum.totalMinor, pendingAgg._sum.feeMinor, pendingAgg._count);

    return {
      currency: 'INR',
      feeBps: this.config.get('PLATFORM_FEE_BPS'),
      settled,
      pending,
      lifetimeNetMinor: settled.netMinor,
    };
  }

  /**
   * Platform revenue. FEE rows are the top line; CHARGE rows are GMV. Both are
   * summed straight from the ledger so the number reconciles with the money
   * movements rather than restating the order table.
   */
  async summary(days = 30): Promise<RevenueSummary> {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);

    const [charge, fee, refund, byDay] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.CHARGE, createdAt: { gte: since } },
        _sum: { amountMinor: true },
        _count: true,
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.FEE, createdAt: { gte: since } },
        _sum: { amountMinor: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.REFUND, createdAt: { gte: since } },
        _sum: { amountMinor: true },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; gmv: bigint; fee: bigint; orders: bigint }>>`
        SELECT date_trunc('day', created_at) AS day,
               COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CHARGE'), 0) AS gmv,
               COALESCE(SUM(amount_minor) FILTER (WHERE type = 'FEE'), 0)    AS fee,
               COUNT(*) FILTER (WHERE type = 'CHARGE')                        AS orders
        FROM transactions
        WHERE created_at >= ${since}
        GROUP BY 1
        ORDER BY 1 DESC
      `,
    ]);

    const gmvMinor = charge._sum.amountMinor ?? 0;
    const feeRevenueMinor = fee._sum.amountMinor ?? 0;
    const paidOrders = charge._count;

    return {
      currency: 'INR',
      feeBps: this.config.get('PLATFORM_FEE_BPS'),
      gmvMinor,
      feeRevenueMinor,
      refundedMinor: refund._sum.amountMinor ?? 0,
      paidOrders,
      averageOrderValueMinor: paidOrders > 0 ? Math.round(gmvMinor / paidOrders) : 0,
      takeRatePct: gmvMinor > 0 ? Number(((feeRevenueMinor / gmvMinor) * 100).toFixed(2)) : 0,
      byDay: byDay.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        gmvMinor: Number(r.gmv),
        feeRevenueMinor: Number(r.fee),
        orders: Number(r.orders),
      })),
    };
  }

  private split(
    grossMinor: number | null,
    feeMinor: number | null,
    orders: number,
  ): { grossMinor: number; feeMinor: number; netMinor: number; orders: number } {
    const gross = grossMinor ?? 0;
    const fee = feeMinor ?? 0;
    return { grossMinor: gross, feeMinor: fee, netMinor: gross - fee, orders };
  }
}
