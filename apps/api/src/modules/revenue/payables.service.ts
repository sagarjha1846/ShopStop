import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Days after the buyer's money lands before held funds are considered overdue.
 *
 * Measured from capture, not from delivery: delivery timestamps live inside the
 * order's mutable `timeline` JSON, and a settlement figure should not depend on
 * a field that later state changes can rewrite. Capture time comes from the
 * CHARGE ledger row, which is immutable. The trade-off is that a slow delivery
 * makes money look overdue when it is legitimately still in transit — `withheld`
 * is reported separately so that case stays visible.
 */
const SETTLEMENT_SLA_DAYS = 7;

export interface AgingBucket {
  bucket: string;
  minor: number;
  orders: number;
}

export interface SellerPayable {
  sellerId: string;
  handle: string;
  owedMinor: number;
  releasableMinor: number;
  orders: number;
  oldestHeldDays: number;
}

export interface Reconciliation {
  collectedMinor: number;
  commissionMinor: number;
  refundedMinor: number;
  paidOutMinor: number;
  /** collected − commission − refunded − paid out. */
  ledgerHeldMinor: number;
  /** Σ (total − fee − paid out) over captured, unrefunded orders. */
  orderHeldMinor: number;
  driftMinor: number;
  balanced: boolean;
}

export interface PayablesReport {
  currency: string;
  asOf: string;
  settlementSlaDays: number;
  /** Buyer money the platform is holding on sellers' behalf. The liability. */
  heldMinor: number;
  /** Delivered and dispute-free — payable now. */
  releasableMinor: number;
  /** In transit, returned, or disputed — must not be paid out yet. */
  withheldMinor: number;
  /** Releasable money held longer than the SLA. The number that needs action. */
  overdueMinor: number;
  sellerCount: number;
  orderCount: number;
  oldestHeldDays: number;
  aging: AgingBucket[];
  bySeller: SellerPayable[];
  reconciliation: Reconciliation;
}

/**
 * Rows for every order whose money the platform is currently holding.
 *
 * A marketplace that collects the buyer's full payment owes the seller everything
 * except its commission, and that debt exists from capture until settlement. It is
 * the largest number on the balance sheet and nothing in the system stated it, so
 * neither the float nor the liability could be quantified.
 *
 * Money is releasable only once the buyer has the goods and no dispute is open;
 * anything else is withheld. The default is to withhold, so a status this query
 * does not know about can never be mistaken for payable.
 */
const PAYABLE_ORDERS = Prisma.sql`
  SELECT o.id,
         o.seller_id,
         (o.total_minor - o.fee_minor) - COALESCE(po.paid, 0) AS owed_minor,
         c.captured_at,
         (o.status = 'DELIVERED' AND (d.status IS NULL OR d.status = 'RESOLVED_RELEASE')) AS releasable
  FROM orders o
  JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
  -- Capture time from the ledger, not payments.updated_at: the CHARGE row is
  -- written once and never rewritten, so aging cannot drift under later edits.
  JOIN LATERAL (
    SELECT MIN(created_at) AS captured_at FROM transactions
    WHERE order_id = o.id AND type = 'CHARGE'
  ) c ON c.captured_at IS NOT NULL
  LEFT JOIN disputes d ON d.order_id = o.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount_minor), 0) AS paid FROM transactions
    WHERE order_id = o.id AND type = 'PAYOUT'
  ) po ON TRUE
  WHERE o.status <> 'REFUNDED'
    AND (o.total_minor - o.fee_minor) - COALESCE(po.paid, 0) > 0
`;

@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the platform owes sellers right now, aged, with a reconciliation that
   * proves the figure against the ledger.
   */
  async report(topSellers = 20): Promise<PayablesReport> {
    const limit = Math.min(Math.max(topSellers, 1), 100);

    const [totals, aging, bySeller, ledger] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          held: bigint | null;
          releasable: bigint | null;
          overdue: bigint | null;
          orders: bigint;
          sellers: bigint;
          oldest_days: number | null;
        }>
      >`
        WITH payable AS (${PAYABLE_ORDERS})
        SELECT COALESCE(SUM(owed_minor), 0)                                   AS held,
               COALESCE(SUM(owed_minor) FILTER (WHERE releasable), 0)         AS releasable,
               COALESCE(SUM(owed_minor) FILTER (
                 WHERE releasable
                   AND captured_at < now() - (${SETTLEMENT_SLA_DAYS} * interval '1 day')
               ), 0)                                                          AS overdue,
               COUNT(*)                                                       AS orders,
               COUNT(DISTINCT seller_id)                                      AS sellers,
               MAX(EXTRACT(EPOCH FROM (now() - captured_at)) / 86400)::float8 AS oldest_days
        FROM payable
      `,
      this.prisma.$queryRaw<Array<{ bucket: string; minor: bigint; orders: bigint }>>`
        WITH payable AS (${PAYABLE_ORDERS}),
        bucketed AS (
          SELECT owed_minor,
                 CASE
                   WHEN captured_at >= now() - interval '7 days'  THEN '0-7d'
                   WHEN captured_at >= now() - interval '14 days' THEN '8-14d'
                   WHEN captured_at >= now() - interval '30 days' THEN '15-30d'
                   ELSE '30d+'
                 END AS bucket
          FROM payable
        )
        SELECT bucket, COALESCE(SUM(owed_minor), 0) AS minor, COUNT(*) AS orders
        FROM bucketed GROUP BY 1
      `,
      this.prisma.$queryRaw<
        Array<{
          seller_id: string;
          handle: string;
          owed: bigint;
          releasable: bigint;
          orders: bigint;
          oldest_days: number;
        }>
      >`
        WITH payable AS (${PAYABLE_ORDERS})
        SELECT p.seller_id,
               COALESCE(pr.handle, '(no profile)')                       AS handle,
               COALESCE(SUM(p.owed_minor), 0)                           AS owed,
               COALESCE(SUM(p.owed_minor) FILTER (WHERE p.releasable), 0) AS releasable,
               COUNT(*)                                                  AS orders,
               MAX(EXTRACT(EPOCH FROM (now() - p.captured_at)) / 86400)::float8 AS oldest_days
        FROM payable p
        -- LEFT, not inner: a debt must never vanish from the report because a
        -- seller has no profile row. The seller id is the identifier that pays.
        LEFT JOIN profiles pr ON pr.user_id = p.seller_id
        GROUP BY 1, 2
        ORDER BY 3 DESC
        LIMIT ${limit}
      `,
      // Same liability, derived independently from the immutable ledger. Order
      // commission carries an order id; boost and subscription FEE rows do not,
      // which is what keeps non-merchandise revenue out of the settlement maths.
      this.prisma.$queryRaw<
        Array<{ collected: bigint; commission: bigint; refunded: bigint; paid_out: bigint }>
      >`
        SELECT COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CHARGE'), 0)  AS collected,
               COALESCE(SUM(amount_minor) FILTER (
                 WHERE type = 'FEE' AND order_id IS NOT NULL), 0)             AS commission,
               COALESCE(SUM(amount_minor) FILTER (WHERE type = 'REFUND'), 0)  AS refunded,
               COALESCE(SUM(amount_minor) FILTER (WHERE type = 'PAYOUT'), 0)  AS paid_out
        FROM transactions
      `,
    ]);

    const t = totals[0];
    const heldMinor = Number(t?.held ?? 0);
    const releasableMinor = Number(t?.releasable ?? 0);
    const l = ledger[0];
    const collectedMinor = Number(l?.collected ?? 0);
    const commissionMinor = Number(l?.commission ?? 0);
    const refundedMinor = Number(l?.refunded ?? 0);
    const paidOutMinor = Number(l?.paid_out ?? 0);
    const ledgerHeldMinor = collectedMinor - commissionMinor - refundedMinor - paidOutMinor;

    // Order-derived and ledger-derived liabilities are computed from different
    // tables and must agree. A gap means the ledger and the orders disagree about
    // money that has already moved, so it is reported rather than reconciled away.
    const driftMinor = heldMinor - ledgerHeldMinor;

    const order = ['0-7d', '8-14d', '15-30d', '30d+'];
    const found = new Map(aging.map((r) => [r.bucket, r]));

    return {
      currency: 'INR',
      asOf: new Date().toISOString(),
      settlementSlaDays: SETTLEMENT_SLA_DAYS,
      heldMinor,
      releasableMinor,
      withheldMinor: heldMinor - releasableMinor,
      overdueMinor: Number(t?.overdue ?? 0),
      sellerCount: Number(t?.sellers ?? 0),
      orderCount: Number(t?.orders ?? 0),
      oldestHeldDays: t?.oldest_days != null ? Number(t.oldest_days.toFixed(1)) : 0,
      // Every bucket is always present, including empty ones: a missing row would
      // read as "no data" when it means "nothing that old", and the difference
      // matters when the report is used to decide what to pay.
      aging: order.map((bucket) => ({
        bucket,
        minor: Number(found.get(bucket)?.minor ?? 0),
        orders: Number(found.get(bucket)?.orders ?? 0),
      })),
      bySeller: bySeller.map((r) => ({
        sellerId: r.seller_id,
        handle: r.handle,
        owedMinor: Number(r.owed),
        releasableMinor: Number(r.releasable),
        orders: Number(r.orders),
        oldestHeldDays: Number(Number(r.oldest_days).toFixed(1)),
      })),
      reconciliation: {
        collectedMinor,
        commissionMinor,
        refundedMinor,
        paidOutMinor,
        ledgerHeldMinor,
        orderHeldMinor: heldMinor,
        driftMinor,
        balanced: driftMinor === 0,
      },
    };
  }
}
