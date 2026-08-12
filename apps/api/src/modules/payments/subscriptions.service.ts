import { Injectable, Logger } from '@nestjs/common';
import {
  SubscriptionPlan,
  SubscriptionStatus,
  TransactionType,
  type Subscription,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { AppError } from '../../common/errors/app-error';
import type { IPaymentProvider } from './provider/payment-provider';

/** Listings/hour allowed before the risk engine flags velocity. */
export const FREE_LISTING_VELOCITY = 10;
export const PRO_LISTING_VELOCITY = 50;
/** Sponsored-placement days included with a Pro period. */
export const PRO_INCLUDED_BOOST_DAYS = 5;

const PERIOD_DAYS = 30;

export interface SubscriptionQuote {
  subscriptionId: string;
  plan: SubscriptionPlan;
  amountMinor: number;
  currency: string;
  providerOrderId: string;
  clientToken: string;
}

/**
 * Paid seller plans.
 *
 * Deliberately sells capability, never trust: a Pro seller gets a higher listing
 * allowance and included boost credit, but the BUSINESS badge remains tied to
 * SellerVerification. On a marketplace whose product *is* trust, a purchasable
 * trust signal would be worth less than nothing.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  priceMinor(): number {
    return this.config.get('SUBSCRIPTION_PRO_PRICE_MINOR');
  }

  plans() {
    return {
      currency: 'INR',
      plans: [
        {
          plan: 'FREE',
          priceMinor: 0,
          listingsPerHour: FREE_LISTING_VELOCITY,
          includedBoostDays: 0,
          features: ['List and sell', 'Buyer↔seller chat', 'Earnings dashboard'],
        },
        {
          plan: 'PRO',
          priceMinor: this.priceMinor(),
          periodDays: PERIOD_DAYS,
          listingsPerHour: PRO_LISTING_VELOCITY,
          includedBoostDays: PRO_INCLUDED_BOOST_DAYS,
          features: [
            `List up to ${PRO_LISTING_VELOCITY} items an hour`,
            `${PRO_INCLUDED_BOOST_DAYS} days of sponsored placement each month`,
            'Priority support queue',
          ],
          // Stated on the plan itself so it cannot quietly change into a trust sale.
          notIncluded: ['Verification badges — those are earned, never bought'],
        },
      ],
    };
  }

  /** The seller's current plan, or null when they are on the free tier. */
  async current(userId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] },
        currentPeriodEnd: { gt: new Date() },
      },
      orderBy: { currentPeriodEnd: 'desc' },
    });
  }

  /** Whether Pro benefits apply right now. Cancelled-but-unexpired still counts. */
  async isPro(userId: string): Promise<boolean> {
    return (await this.current(userId)) !== null;
  }

  /** Listing velocity this seller is allowed before the risk engine flags them. */
  async listingVelocityAllowance(userId: string): Promise<number> {
    return (await this.isPro(userId)) ? PRO_LISTING_VELOCITY : FREE_LISTING_VELOCITY;
  }

  /** Included sponsored-placement days left in the current period. */
  async boostDaysRemaining(userId: string): Promise<number> {
    const sub = await this.current(userId);
    if (!sub) return 0;
    return Math.max(PRO_INCLUDED_BOOST_DAYS - sub.boostDaysUsed, 0);
  }

  /**
   * Reserve included boost days, returning how many were actually taken.
   *
   * Conditional update rather than read-then-write: two boosts bought at once
   * would otherwise both see the same remaining balance and spend it twice,
   * giving away placement that was never included.
   */
  async reserveBoostDays(
    userId: string,
    wanted: number,
    attempt = 0,
  ): Promise<{ subscriptionId: string; days: number } | null> {
    if (wanted <= 0 || attempt > 3) return null;
    const sub = await this.current(userId);
    if (!sub) return null;

    const available = Math.max(PRO_INCLUDED_BOOST_DAYS - sub.boostDaysUsed, 0);
    const days = Math.min(wanted, available);
    if (days <= 0) return null;

    const claimed = await this.prisma.subscription.updateMany({
      where: { id: sub.id, boostDaysUsed: sub.boostDaysUsed },
      data: { boostDaysUsed: sub.boostDaysUsed + days },
    });
    // Lost the race to a concurrent purchase — retry against fresh state, bounded
    // so a pathological contention loop can't spin forever.
    if (claimed.count === 0) return this.reserveBoostDays(userId, wanted, attempt + 1);

    return { subscriptionId: sub.id, days };
  }

  /** Give reserved days back when the purchase they were held for never completes. */
  async releaseBoostDays(subscriptionId: string, days: number): Promise<void> {
    if (days <= 0) return;
    await this.prisma.subscription.updateMany({
      where: { id: subscriptionId, boostDaysUsed: { gte: days } },
      data: { boostDaysUsed: { decrement: days } },
    });
  }

  /** Start a subscription: record it pending and open a gateway intent. */
  async subscribe(userId: string, provider: IPaymentProvider): Promise<SubscriptionQuote> {
    if (await this.isPro(userId)) throw AppError.conflict('You already have an active Pro plan');

    const amountMinor = this.priceMinor();
    if (amountMinor <= 0) throw AppError.validation('Subscription pricing is not configured');

    const sub = await this.prisma.subscription.create({
      data: { userId, plan: SubscriptionPlan.PRO, priceMinor: amountMinor, provider: provider.key },
    });

    const intent = await provider.createIntent({
      amountMinor,
      currency: 'INR',
      orderId: sub.id,
      receipt: `sub_${sub.id.slice(-16)}`,
    });

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { providerOrderId: intent.providerOrderId },
    });

    return {
      subscriptionId: sub.id,
      plan: SubscriptionPlan.PRO,
      amountMinor,
      currency: 'INR',
      providerOrderId: intent.providerOrderId,
      clientToken: intent.clientToken,
    };
  }

  /**
   * Activate a paid subscription. Returns false when this delivery didn't claim
   * it — same compare-and-set discipline as orders and boosts, because gateways
   * retry and a subscription must not be booked (or extended) twice.
   */
  async activateFromWebhook(
    providerOrderId: string,
    providerPaymentId?: string,
    amountMinor?: number,
  ): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({ where: { providerOrderId } });
    if (!sub) return false;

    if (amountMinor !== undefined && amountMinor !== sub.priceMinor) {
      this.logger.error(`Subscription amount mismatch on ${sub.id}: quoted ${sub.priceMinor}, captured ${amountMinor}`);
      throw AppError.conflict('Captured amount does not match the subscription price');
    }

    const start = new Date();
    const end = new Date(start.getTime() + PERIOD_DAYS * 86_400_000);

    const activated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscription.updateMany({
        where: { id: sub.id, status: SubscriptionStatus.PENDING_PAYMENT },
        data: {
          status: SubscriptionStatus.ACTIVE,
          providerPaymentId,
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });
      if (claimed.count === 0) return false;

      // Its own revenue stream, like boosts: subscription income is not a cut of
      // merchandise, so it must not land in GMV or the take-rate denominator.
      await tx.transaction.create({
        data: {
          userId: sub.userId,
          type: TransactionType.FEE,
          amountMinor: sub.priceMinor,
          currency: sub.currency,
          providerRef: providerPaymentId,
          meta: { basis: 'subscription', subscriptionId: sub.id, plan: sub.plan },
        },
      });
      return true;
    });

    if (activated) this.logger.log(`Subscription ${sub.id} activated (${sub.priceMinor})`);
    return activated;
  }

  async failFromWebhook(providerOrderId: string): Promise<boolean> {
    const res = await this.prisma.subscription.updateMany({
      where: { providerOrderId, status: SubscriptionStatus.PENDING_PAYMENT },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    return res.count > 0;
  }

  /**
   * Cancel: stop renewing, but keep the benefits for the period already paid for.
   * Ending them at the click would be taking money for time not delivered.
   */
  async cancel(userId: string): Promise<Subscription> {
    const active = await this.current(userId);
    if (!active) throw AppError.notFound('Active subscription');
    if (active.status === SubscriptionStatus.CANCELLED) return active;

    return this.prisma.subscription.update({
      where: { id: active.id },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    });
  }
}
