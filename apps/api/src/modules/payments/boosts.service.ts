import { Injectable, Logger } from '@nestjs/common';
import {
  BoostStatus,
  ListingStatus,
  PaymentProvider as ProviderEnum,
  TransactionType,
  type BoostPurchase,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { AppError } from '../../common/errors/app-error';
import type { IPaymentProvider } from './provider/payment-provider';

export interface BoostQuote {
  boostId: string;
  listingId: string;
  days: number;
  amountMinor: number;
  currency: string;
  provider: ProviderEnum;
  providerOrderId: string;
  clientToken: string;
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
    const amountMinor = normalizedDays * this.pricePerDayMinor();
    if (amountMinor <= 0) throw AppError.validation('Boost pricing is not configured');

    const purchase = await this.prisma.boostPurchase.create({
      data: {
        listingId,
        sellerId,
        days: normalizedDays,
        amountMinor,
        currency: listing.currency,
        provider: provider.key,
      },
    });

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
      amountMinor,
      currency: listing.currency,
      provider: provider.key,
      providerOrderId: intent.providerOrderId,
      clientToken: intent.clientToken,
    };
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

      // Extend from whichever is later: an unexpired existing window, or now — so
      // buying a second boost stacks instead of truncating what was already paid for.
      const listing = await tx.listing.findUnique({
        where: { id: purchase.listingId },
        select: { boostedUntil: true },
      });
      const base =
        listing?.boostedUntil && listing.boostedUntil > startsAt ? listing.boostedUntil : startsAt;
      await tx.listing.update({
        where: { id: purchase.listingId },
        data: { boostedUntil: new Date(base.getTime() + purchase.days * 86_400_000) },
      });

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

  /** Mark a boost purchase failed so it stops showing as awaiting payment. */
  async failFromWebhook(providerOrderId: string): Promise<boolean> {
    const res = await this.prisma.boostPurchase.updateMany({
      where: { providerOrderId, status: BoostStatus.PENDING_PAYMENT },
      data: { status: BoostStatus.FAILED },
    });
    return res.count > 0;
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
