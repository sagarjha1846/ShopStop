import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A single funnel metric, reported with the raw counts behind it.
 *
 * Percentages are shown with their numerator and denominator on purpose: a
 * conversion rate off three listings is noise, and a bare "33%" hides that.
 */
export interface FunnelMetric {
  key: string;
  label: string;
  /** Null when the window holds too little data to say anything. */
  value: number | null;
  unit: 'pct' | 'count' | 'per100';
  numerator: number;
  denominator: number;
  /** Target from docs/01 §7, where one is defined. */
  target: number | null;
  targetDirection: 'gte' | 'lte';
  meets: boolean | null;
  note?: string;
}

export interface FunnelReport {
  windowDays: number;
  since: string;
  northStarPerWeek: number | null;
  metrics: FunnelMetric[];
  /** PRD metrics that genuinely cannot be computed yet, and why. */
  notMeasurable: Array<{ metric: string; reason: string }>;
}

const pct = (n: number, d: number): number | null =>
  d === 0 ? null : Number(((n / d) * 100).toFixed(1));

@Injectable()
export class FunnelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The PRD's success metrics (docs/01 §7), computed from operational tables.
   *
   * Deliberately derived rather than tracked: every number here comes from
   * listings, threads, orders and disputes, so it needs no event pipeline, works
   * retroactively over all history, and collects nothing about users that
   * running the marketplace didn't already require.
   */
  async report(days = 30): Promise<FunnelReport> {
    const windowDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [acquisition, activation, liquidity, conversion, disputes, verified, northStar, retention] =
      await Promise.all([
        // Acquisition — new users who verified email or phone in the window.
        this.prisma.$queryRaw<Array<{ verified: bigint; total: bigint }>>`
          SELECT COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL OR phone_verified_at IS NOT NULL) AS verified,
                 COUNT(*) AS total
          FROM users WHERE created_at >= ${since} AND deleted_at IS NULL
        `,
        // Activation — of users who have HAD a full 7 days, how many listed or
        // messaged inside that window. Registrations newer than 7 days are excluded
        // rather than counted as failures; including them would drag the rate down
        // purely because the clock hasn't run out yet.
        this.prisma.$queryRaw<Array<{ activated: bigint; cohort: bigint }>>`
          WITH cohort AS (
            SELECT id, created_at FROM users
            WHERE created_at >= ${since} AND created_at <= NOW() - INTERVAL '7 days' AND deleted_at IS NULL
          )
          SELECT COUNT(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = c.id AND l.created_at <= c.created_at + INTERVAL '7 days')
                      OR EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = c.id AND m.created_at <= c.created_at + INTERVAL '7 days')
                 ) AS activated,
                 COUNT(*) AS cohort
          FROM cohort c
        `,
        // Liquidity — published listings that drew any buyer contact. A public
        // question counts alongside a chat thread: it is the same signal (a buyer
        // engaged this listing) at a lower commitment, and excluding it would
        // undercount exactly the engagement Q&A exists to create.
        this.prisma.$queryRaw<Array<{ withthread: bigint; published: bigint }>>`
          SELECT COUNT(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM threads t WHERE t.listing_id = l.id)
                      OR EXISTS (SELECT 1 FROM listing_questions q WHERE q.listing_id = l.id AND q.hidden_at IS NULL)
                 ) AS withthread,
                 COUNT(*) AS published
          FROM listings l
          WHERE l.published_at >= ${since} AND l.deleted_at IS NULL
        `,
        // Conversion — conversations that produced a paid order.
        this.prisma.$queryRaw<Array<{ converted: bigint; threads: bigint }>>`
          SELECT COUNT(*) FILTER (
                   WHERE EXISTS (
                     SELECT 1 FROM orders o
                     JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
                     WHERE o.listing_id = t.listing_id AND o.created_at >= t.created_at
                   )
                 ) AS converted,
                 COUNT(*) AS threads
          FROM threads t
          WHERE t.created_at >= ${since} AND t.listing_id IS NOT NULL
        `,
        // Trust NSM — disputes per 100 paid orders.
        this.prisma.$queryRaw<Array<{ disputed: bigint; paid: bigint }>>`
          SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id)) AS disputed,
                 COUNT(*) AS paid
          FROM orders o
          JOIN payments p ON p.order_id = o.id AND p.status = 'CAPTURED'
          WHERE o.created_at >= ${since}
        `,
        // Trust — orders where at least one side is a verified identity.
        this.prisma.$queryRaw<Array<{ withverified: bigint; total: bigint }>>`
          SELECT COUNT(*) FILTER (
                   WHERE b.email_verified_at IS NOT NULL OR b.phone_verified_at IS NOT NULL
                      OR s.email_verified_at IS NOT NULL OR s.phone_verified_at IS NOT NULL
                 ) AS withverified,
                 COUNT(*) AS total
          FROM orders o
          JOIN users b ON b.id = o.buyer_id
          JOIN users s ON s.id = o.seller_id
          WHERE o.created_at >= ${since}
        `,
        // North Star — delivered, dispute-free transactions per week.
        this.prisma.$queryRaw<Array<{ clean: bigint }>>`
          SELECT COUNT(*) AS clean
          FROM orders o
          WHERE o.status = 'DELIVERED' AND o.created_at >= ${since}
            AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id)
        `,
        // Retention — accounts older than 30 days with a session used recently.
        // A session-activity proxy, not true product retention; labelled as such.
        this.prisma.$queryRaw<Array<{ returned: bigint; eligible: bigint }>>`
          WITH eligible AS (
            SELECT id FROM users WHERE created_at <= NOW() - INTERVAL '30 days' AND deleted_at IS NULL
          )
          SELECT COUNT(*) FILTER (
                   WHERE EXISTS (
                     SELECT 1 FROM sessions s
                     WHERE s.user_id = e.id AND s.last_used_at >= NOW() - INTERVAL '30 days'
                   )
                 ) AS returned,
                 COUNT(*) AS eligible
          FROM eligible e
        `,
      ]);

    const n = (v: bigint | undefined) => Number(v ?? 0);
    const metric = (
      key: string,
      label: string,
      numerator: number,
      denominator: number,
      target: number | null,
      targetDirection: 'gte' | 'lte' = 'gte',
      unit: FunnelMetric['unit'] = 'pct',
      note?: string,
    ): FunnelMetric => {
      const value =
        unit === 'per100'
          ? denominator === 0
            ? null
            : Number(((numerator / denominator) * 100).toFixed(2))
          : unit === 'count'
            ? numerator
            : pct(numerator, denominator);
      return {
        key,
        label,
        value,
        unit,
        numerator,
        denominator,
        target,
        targetDirection,
        meets:
          value === null || target === null
            ? null
            : targetDirection === 'gte'
              ? value >= target
              : value <= target,
        note,
      };
    };

    const weeks = windowDays / 7;

    return {
      windowDays,
      since: since.toISOString(),
      northStarPerWeek:
        n(northStar[0]?.clean) === 0 ? 0 : Number((n(northStar[0]?.clean) / weeks).toFixed(1)),
      metrics: [
        metric('acquisition', 'New verified users', n(acquisition[0]?.verified), n(acquisition[0]?.total), null, 'gte', 'count',
          'Verified share of sign-ups in the window.'),
        metric('activation', 'Listed or messaged within 7 days', n(activation[0]?.activated), n(activation[0]?.cohort), 25, 'gte', 'pct',
          'Only counts sign-ups that have had a full 7 days.'),
        metric('liquidity', 'Listing → buyer contact', n(liquidity[0]?.withthread), n(liquidity[0]?.published), 15, 'gte', 'pct',
          'Counts a chat thread or a public question.'),
        metric('conversion', 'Message → paid transaction', n(conversion[0]?.converted), n(conversion[0]?.threads), 8),
        metric('disputeRate', 'Disputes per 100 transactions', n(disputes[0]?.disputed), n(disputes[0]?.paid), 2, 'lte', 'per100'),
        metric('verifiedParty', 'Transactions with a verified party', n(verified[0]?.withverified), n(verified[0]?.total), 70),
        metric('retention', '30-day returning users', n(retention[0]?.returned), n(retention[0]?.eligible), 30, 'gte', 'pct',
          'Session-activity proxy, not true product retention.'),
      ],
      notMeasurable: [
        {
          metric: 'Median time-to-takedown for flagged listings',
          reason:
            'Moderation actions are not linked back to the fraud event that raised them, so the clock has no start.',
        },
      ],
    };
  }
}
