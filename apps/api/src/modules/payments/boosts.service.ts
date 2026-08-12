import { Injectable, Logger } from '@nestjs/common';
import {
  BoostStatus,
  ListingStatus,
  PaymentProvider as ProviderEnum,
  TransactionType,
  type BoostPurchase,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { AppError } from '../../common/errors/app-error';
import { SubscriptionsService } from './subscriptions.service';
import type { IPaymentProvider } from './provider/payment-provider';

export interface BoostQuote {
  boostId: string;
  listingId: string;
  days: number;
  /** Days covered by the seller's plan credit. */
  creditDays: number;
  /** What is left to pay after credit. Zero means it is already live. */
  amountMinor: number;
  currency: string;
  provider: ProviderEnum;
  providerOrderId: string | null;
  clientToken: string | null;
  activated: boolean;
}

const MAX_BOOST_DAYS = 30;

/**
 * Sponsored placement, sold rather than granted.
 *
 * A boost is a product: the seller buys a window, and the window only opens when
 * the gateway confirms payment. Previously `boost()` set boostedUntil directly,
 * which gave the inventory away for free and made the badge meaningless — if
 * every listing can boost at no cost, boosting stops signalling anything.
 */
@Injectable()
export class BoostsService {
  private readonly logger = new Logger(BoostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  pricePerDayMinor(): number {
    return this.config.get('BOOST_PRICE_PER_DAY_MINOR');
  }

  quoteMinor(days: number): number {
    return this.normalizeDays(days) * this.pricePerDayMinor();
  }

  /**
   * Start a boost purchase: price it, record it as PENDING_PAYMENT, and open a
   * gateway intent. Nothing about the listing changes until the webhook lands.
   */
  async purchase(
    sellerId: string,
    listingId: string,
    days: number,
    provider: IPaymentProvider,
  ): Promise<BoostQuote> {
    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, deletedAt: null } });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.sellerId !== sellerId) throw AppError.forbidden('You can only boost your own listing');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw AppError.illegalState('Only an active listing can be boosted');
    }

    const normalizedDays = this.normalizeDays(days);
    if (this.pricePerDayMinor() <= 0) throw AppError.validation('Boost pricing is not configured');

    // A paid plan's included days are spent before anything is charged. Reserved
    // up front (like a coupon redemption) and released if the purchase fails.
    const reserved = await this.subscriptions.reserveBoostDays(sellerId, normalizedDays);
    const creditDays = reserved?.days ?? 0;
    const amountMinor = (normalizedDays - creditDays) * this.pricePerDayMinor();

    const purchase = await this.prisma.boostPurchase.create({
      data: {
        listingId,
        sellerId,
        days: normalizedDays,
        creditDays,
        amountMinor,
        currency: listing.currency,
        provider: provider.key,
      },
    });

    // Fully covered by plan credit: nothing to charge, so it goes live now. No
    // ledger row either — that revenue was already booked with the subscription,
    // and booking it again would count the same rupees twice.
    if (amountMinor === 0) {
      await this.activateCoveredPurchase(purchase.id);
      return {
        boostId: purchase.id,
        listingId,
        days: normalizedDays,
        creditDays,
        amountMinor: 0,
        currency: listing.currency,
        provider: provider.key,
        providerOrderId: null,
        clientToken: null,
        activated: true,
      };
    }

    try {
      const intent = await provider.createIntent({
        amountMinor,
        currency: listing.currency,
        orderId: purchase.id,
        receipt: `bst_${purchase.id.slice(-16)}`,
      });

      await this.prisma.boostPurchase.update({
        where: { id: purchase.id },
        data: { providerOrderId: intent.providerOrderId },
      });

      return {
        boostId: purchase.id,
        listingId,
        days: normalizedDays,
        creditDays,
        amountMinor,
        currency: listing.currency,
        provider: provider.key,
        providerOrderId: intent.providerOrderId,
        clientToken: intent.clientToken,
        activated: false,
      };
    } catch (err) {
      // Never strand reserved credit on a purchase that never got a payment.
      if (reserved) await this.subscriptions.releaseBoostDays(reserved.subscriptionId, reserved.days);
      throw err;
    }
  }

  /** Activate a purchase that plan credit covered in full — no gateway involved. */
  private async activateCoveredPurchase(purchaseId: string): Promise<void> {
    const purchase = await this.prisma.boostPurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    const startsAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.boostPurchase.updateMany({
        where: { id: purchaseId, status: BoostStatus.PENDING_PAYMENT },
        data: {
          status: BoostStatus.ACTIVE,
          startsAt,
          endsAt: new Date(startsAt.getTime() + purchase.days * 86_400_000),
        },
      });
      if (claimed.count === 0) return;
      await this.extendWindow(tx, purchase.listingId, purchase.days, startsAt);
    });
    this.logger.log(`Boost ${purchaseId} activated from plan credit (${purchase.days}d)`);
  }

  /**
   * Activate a paid boost. Returns false when this delivery did not claim the
   * purchase — either it is not a boost payment, or a concurrent duplicate
   * delivery already activated it. Same compare-and-set discipline as order
   * capture: gateways retry, and boost revenue must be booked exactly once.
   */
  async activateFromWebhook(
    providerOrderId: string,
    providerPaymentId?: string,
    amountMinor?: number,
  ): Promise<boolean> {
    const purchase = await this.prisma.boostPurchase.findUnique({ where: { providerOrderId } });
    if (!purchase) return false;

    if (amountMinor !== undefined && amountMinor !== purchase.amountMinor) {
      this.logger.error(
        `Boost amount mismatch on ${purchase.id}: quoted ${purchase.amountMinor}, captured ${amountMinor}`,
      );
      throw AppError.conflict('Captured amount does not match the boost quote');
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + purchase.days * 86_400_000);

    const activated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.boostPurchase.updateMany({
        where: { id: purchase.id, status: BoostStatus.PENDING_PAYMENT },
        data: { status: BoostStatus.ACTIVE, providerPaymentId, startsAt, endsAt },
      });
      if (claimed.count === 0) return false;

      await this.extendWindow(tx, purchase.listingId, purchase.days, startsAt);

      // Boost spend is 100% platform revenue, so it is booked as FEE only — no
      // CHARGE row. GMV must stay merchandise value; counting ad spend as GMV
      // would inflate it and make the take rate meaningless.
      await tx.transaction.create({
        data: {
          userId: purchase.sellerId,
          type: TransactionType.FEE,
          amountMinor: purchase.amountMinor,
          currency: purchase.currency,
          providerRef: providerPaymentId,
          meta: { basis: 'boost', boostId: purchase.id, listingId: purchase.listingId },
        },
      });
      return true;
    });

    if (activated) this.logger.log(`Boost ${purchase.id} activated (${purchase.amountMinor})`);
    return activated;
  }

  /**
   * Extend the listing's sponsored window from whichever is later: an unexpired
   * existing window, or now. Stacking rather than overwriting means a second
   * boost never truncates time already paid for.
   */
  private async extendWindow(
    tx: Prisma.TransactionClient,
    listingId: string,
    days: number,
    from: Date,
  ): Promise<void> {
    const listing = await tx.listing.findUnique({ where: { id: listingId }, select: { boostedUntil: true } });
    const base = listing?.boostedUntil && listing.boostedUntil > from ? listing.boostedUntil : from;
    await tx.listing.update({
      where: { id: listingId },
      data: { boostedUntil: new Date(base.getTime() + days * 86_400_000) },
    });
  }

  /** Mark a boost purchase failed, and hand back any plan credit it was holding. */
  async failFromWebhook(providerOrderId: string): Promise<boolean> {
    const purchase = await this.prisma.boostPurchase.findUnique({ where: { providerOrderId } });
    if (!purchase || purchase.status !== BoostStatus.PENDING_PAYMENT) return false;

    const res = await this.prisma.boostPurchase.updateMany({
      where: { id: purchase.id, status: BoostStatus.PENDING_PAYMENT },
      data: { status: BoostStatus.FAILED },
    });
    if (res.count === 0) return false;

    if (purchase.creditDays > 0) {
      const sub = await this.subscriptions.current(purchase.sellerId);
      if (sub) await this.subscriptions.releaseBoostDays(sub.id, purchase.creditDays);
    }
    return true;
  }

  async listForSeller(sellerId: string): Promise<BoostPurchase[]> {
    return this.prisma.boostPurchase.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private normalizeDays(days: number): number {
    const d = Number.isFinite(days) ? Math.floor(days) : 0;
    return Math.min(Math.max(d, 1), MAX_BOOST_DAYS);
  }
}
