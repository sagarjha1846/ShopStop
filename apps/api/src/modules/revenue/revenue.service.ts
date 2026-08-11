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

export interface MethodBreakdown {
  method: string;
  gmvMinor: number;
  orders: number;
  /** Commission booked for this method, net of any refund reversals. */
  commissionMinor: number;
  /** What the gateway is estimated to take. An estimate, not a billed figure. */
  estGatewayCostMinor: number;
  /** commission − estimated gateway cost. Negative means the method loses money. */
  estNetMinor: number;
}

export interface RevenueSummary {
  currency: string;
  feeBps: number;
  /** Gross merchandise value: everything buyers actually paid. */
  gmvMinor: number;
  /** What the platform kept — the top line that matters. */
  feeRevenueMinor: number;
  /** Revenue split by stream, so ad income isn't confused with commission. */
  commissionRevenueMinor: number;
  boostRevenueMinor: number;
  subscriptionRevenueMinor: number;
  refundedMinor: number;
  paidOrders: number;
  averageOrderValueMinor: number;
  takeRatePct: number;
  byDay: Array<{ day: string; gmvMinor: number; feeRevenueMinor: number; orders: number }>;
  /**
   * Commission economics by payment method. The commission rate is close to card
   * MDR, so whether commission earns anything depends on how much volume settles
   * over zero-MDR UPI. Without this split, "fee revenue" reads as profit when it
   * may be a pass-through of the processing cost.
   */
  byMethod: MethodBreakdown[];
  /** Commission minus estimated gateway cost, across all methods. */
  estNetCommissionMinor: number;
}

/**
 * Merchant-discount rate by payment method, in basis points.
 *
 * UPI is zero-rated for merchant payments in India, which is why payment mix —
 * not the headline take rate — decides whether commission has a margin. These are
 * planning assumptions from docs/16; replace them with contracted rates before
 * making a pricing decision on the output.
 */
const MDR_BPS: Readonly<Record<string, number>> = {
  upi: 0,
  netbanking: 90,
  wallet: 200,
  emi: 300,
};

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
        // A refunded order keeps its CAPTURED payment, so it has to be excluded
        // explicitly — otherwise a seller's settled earnings include sales whose
        // money went back to the buyer.
        where: { sellerId, payment: { status: 'CAPTURED' }, status: { not: OrderStatus.REFUNDED } },
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

    const [charge, fee, refund, byDay, byStream, methodRows] = await Promise.all([
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
      // Revenue by stream. `meta.basis` is written at booking time ('boost' for
      // sponsored placement, 'order.commission' for the take rate); rows booked
      // before that tag existed fall through to commission.
      this.prisma.$queryRaw<Array<{ basis: string | null; total: bigint }>>`
        SELECT meta->>'basis' AS basis, COALESCE(SUM(amount_minor), 0) AS total
        FROM transactions
        WHERE type = 'FEE' AND created_at >= ${since}
        GROUP BY 1
      `,
      // Order-linked ledger rows joined to the payment that funded them. Boost FEE
      // rows carry no orderId, so the join excludes them — correct, since ad spend
      // has no per-order payment method. FEE reversals net out automatically.
      this.prisma.$queryRaw<Array<{ method: string; gmv: bigint; fee: bigint; orders: bigint }>>`
        SELECT COALESCE(p.method, 'unknown') AS method,
               COALESCE(SUM(t.amount_minor) FILTER (WHERE t.type = 'CHARGE'), 0) AS gmv,
               COALESCE(SUM(t.amount_minor) FILTER (WHERE t.type = 'FEE'), 0)    AS fee,
               COUNT(*) FILTER (WHERE t.type = 'CHARGE')                          AS orders
        FROM transactions t
        JOIN payments p ON p.order_id = t.order_id
        WHERE t.created_at >= ${since} AND t.order_id IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
      `,
    ]);

    const gmvMinor = charge._sum.amountMinor ?? 0;
    const feeRevenueMinor = fee._sum.amountMinor ?? 0;
    const paidOrders = charge._count;
    const boostRevenueMinor = Number(byStream.find((r) => r.basis === 'boost')?.total ?? 0);
    const subscriptionRevenueMinor = Number(byStream.find((r) => r.basis === 'subscription')?.total ?? 0);
    // Commission is what's left once the non-merchandise streams are removed.
    const commissionRevenueMinor = feeRevenueMinor - boostRevenueMinor - subscriptionRevenueMinor;

    const cardBps = this.config.get('MDR_CARD_BPS');
    const byMethod: MethodBreakdown[] = methodRows.map((r) => {
      const gmv = Number(r.gmv);
      const commission = Number(r.fee);
      // Unknown methods are costed at the card rate: assuming the expensive case
      // keeps this from flattering the margin.
      const bps = MDR_BPS[r.method] ?? cardBps;
      const estGatewayCostMinor = Math.round((gmv * bps) / 10_000);
      return {
        method: r.method,
        gmvMinor: gmv,
        orders: Number(r.orders),
        commissionMinor: commission,
        estGatewayCostMinor,
        estNetMinor: commission - estGatewayCostMinor,
      };
    });
    const estNetCommissionMinor = byMethod.reduce((acc, m) => acc + m.estNetMinor, 0);

    return {
      currency: 'INR',
      feeBps: this.config.get('PLATFORM_FEE_BPS'),
      gmvMinor,
      feeRevenueMinor,
      commissionRevenueMinor,
      boostRevenueMinor,
      subscriptionRevenueMinor,
      refundedMinor: refund._sum.amountMinor ?? 0,
      paidOrders,
      averageOrderValueMinor: paidOrders > 0 ? Math.round(gmvMinor / paidOrders) : 0,
      // Commission over GMV. Boost and subscription revenue are excluded on purpose:
      // neither is a cut of merchandise, and folding them in would report a take rate
      // above the configured rate and make the number impossible to sanity-check.
      takeRatePct: gmvMinor > 0 ? Number(((commissionRevenueMinor / gmvMinor) * 100).toFixed(2)) : 0,
      byDay: byDay.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        gmvMinor: Number(r.gmv),
        feeRevenueMinor: Number(r.fee),
        orders: Number(r.orders),
      })),
      byMethod,
      estNetCommissionMinor,
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
