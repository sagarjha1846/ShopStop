import { Injectable } from '@nestjs/common';
import { MessageKind, OfferStatus, OrderStatus, type Order, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { CouponsService } from '../coupons/coupons.service';
import { RefundsService } from '../payments/refunds.service';
import { TrustScoreService } from '../trust/trust-score.service';
import { AppConfigService } from '../../config/config.service';
import { FeatureFlagsService } from '../flags/feature-flags.service';
import { resolveTransition, type OrderAction, type OrderActor } from './order.state';
import type { CreateOrderDto } from './dto/order.dto';

interface TimelineEntry {
  status: OrderStatus;
  actor: OrderActor;
  at: string;
  note?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly coupons: CouponsService,
    private readonly refunds: RefundsService,
    private readonly trust: TrustScoreService,
    private readonly config: AppConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Platform take-rate in basis points, from config so the business can retune it
   * without a deploy of code logic (docs/18). The rate is read per order and
   * snapshotted onto the row, so changing it never re-prices historical orders.
   */
  private get platformFeeBps(): number {
    return this.config.get('PLATFORM_FEE_BPS');
  }

  async create(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: dto.listingId, deletedAt: null },
    });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.status !== 'ACTIVE') throw AppError.illegalState('This listing is not available for purchase');
    if (listing.sellerId === buyerId) throw AppError.validation('You cannot buy your own listing');

    const quantity = dto.quantity ?? 1;
    if (quantity > listing.quantity) throw AppError.validation('Requested quantity exceeds availability');

    // Price: an accepted offer (owned by this buyer, on this listing) overrides list price.
    let unitPriceMinor = listing.priceMinor;
    if (dto.offerMessageId) {
      unitPriceMinor = await this.resolveAcceptedOfferPrice(dto.offerMessageId, dto.listingId, buyerId);
    }

    const subtotalMinor = unitPriceMinor * quantity;

    // Optional coupon: validate + reserve a redemption; discount capped at subtotal.
    let discountMinor = 0;
    let couponId: string | undefined;
    if (dto.couponCode?.trim()) {
      const applied = await this.coupons.validateAndReserve(dto.couponCode, listing.sellerId, subtotalMinor);
      discountMinor = applied.discountMinor;
      couponId = applied.couponId;
    }

    // Buyer pays subtotal minus discount; the platform's cut comes out of the
    // seller's proceeds, so the fee is computed on the discounted amount.
    const totalMinor = subtotalMinor - discountMinor;
    // The commission flag lets the launch phase run fee-free without a redeploy
    // (docs/18 R5). The rate is still snapshotted per order, so orders priced
    // while it was off stay at zero even after it is switched back on.
    const commissionOn = await this.flags.isEnabled('monetization.commission');
    const feeMinor = commissionOn ? Math.round((totalMinor * this.platformFeeBps) / 10_000) : 0;

    const timeline: TimelineEntry[] = [
      { status: OrderStatus.PENDING, actor: 'buyer', at: new Date().toISOString() },
    ];

    try {
      return await this.prisma.order.create({
        data: {
          listingId: listing.id,
          buyerId,
          sellerId: listing.sellerId,
          status: OrderStatus.PENDING,
          quantity,
          unitPriceMinor,
          subtotalMinor,
          discountMinor,
          feeMinor,
          totalMinor,
          currency: listing.currency,
          couponId,
          shippingAddressId: dto.shippingAddressId,
          timeline: timeline as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Order row failed after reserving a redemption → give it back.
      if (couponId) await this.coupons.release(couponId).catch(() => undefined);
      throw err;
    }
  }

  async get(orderId: string, userId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        listing: { select: { id: true, title: true, slug: true } },
        payment: true,
      },
    });
    if (!order) throw AppError.notFound('Order');
    if (order.buyerId !== userId && order.sellerId !== userId) throw AppError.forbidden();
    return order;
  }

  async list(userId: string, role: 'buyer' | 'seller'): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: role === 'buyer' ? { buyerId: userId } : { sellerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { listing: { select: { id: true, title: true } }, payment: { select: { status: true } } },
      take: 100,
    });
  }

  /** Apply a lifecycle transition, authorizing by the caller's role on the order. */
  async transition(orderId: string, userId: string, action: OrderAction, note?: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppError.notFound('Order');
    const actor = this.actorFor(order, userId);
    return this.applyTransition(order, action, actor, note);
  }

  /** Called by the payments webhook to advance PENDING → ACCEPTED on capture. */
  async markPaid(orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw AppError.notFound('Order');
    if (order.status !== OrderStatus.PENDING) return order; // idempotent: already advanced
    return this.applyTransition(order, 'accept', 'system', 'Payment captured');
  }

  // ---- internals ----

  private async applyTransition(
    order: Order,
    action: OrderAction,
    actor: OrderActor,
    note?: string,
  ): Promise<Order> {
    const nextStatus = resolveTransition(action, order.status, actor);

    // Ending a paid sale has to give the money back. Cancelling an ACCEPTED order
    // and the `refund` action both used to change status and nothing else, so the
    // buyer saw CANCELLED or REFUNDED while their payment stayed in the platform's
    // account. Refund first: if the gateway will not return the money, the order
    // must not move to a state that says it did. Unpaid orders refund nothing and
    // carry on.
    if (nextStatus === OrderStatus.CANCELLED || nextStatus === OrderStatus.REFUNDED) {
      await this.refunds.refundOrder(order.id, undefined, `order-${action}-${order.id}`);
    }

    const timeline = [
      ...(Array.isArray(order.timeline) ? (order.timeline as unknown as TimelineEntry[]) : []),
      { status: nextStatus, actor, at: new Date().toISOString(), note },
    ];

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          trackingNote: note ?? order.trackingNote,
          timeline: timeline as unknown as Prisma.InputJsonValue,
        },
      });

      // Inventory: decrement on ACCEPTED; mark listing SOLD when depleted.
      if (nextStatus === OrderStatus.ACCEPTED) {
        const listing = await tx.listing.update({
          where: { id: order.listingId },
          data: { quantity: { decrement: order.quantity } },
        });
        if (listing.quantity <= 0) {
          await tx.listing.update({ where: { id: listing.id }, data: { status: 'SOLD' } });
        }
      }
      // Restock on cancel/refund of a previously-accepted order.
      if (
        (nextStatus === OrderStatus.CANCELLED || nextStatus === OrderStatus.REFUNDED) &&
        order.status === OrderStatus.ACCEPTED
      ) {
        await tx.listing.update({
          where: { id: order.listingId },
          data: { quantity: { increment: order.quantity }, status: 'ACTIVE' },
        });
      }
      return row;
    });

    // Give back the coupon redemption if the order is abandoned before fulfilment.
    if ((nextStatus === OrderStatus.CANCELLED || nextStatus === OrderStatus.REJECTED) && order.couponId) {
      await this.coupons.release(order.couponId).catch(() => undefined);
    }

    // A completed sale improves the seller's reputation → recompute trust score.
    if (nextStatus === OrderStatus.DELIVERED) this.trust.recomputeAsync(order.sellerId);

    // Notify the counterparty (the party who did NOT trigger this transition).
    const recipient = actor === 'buyer' ? order.sellerId : order.buyerId;
    await this.notifications
      .notify({
        userId: recipient,
        type: 'order.update',
        title: `Order ${nextStatus.toLowerCase()}`,
        body: note ?? undefined,
        data: { orderId: order.id, status: nextStatus },
      })
      .catch(() => undefined);

    return updated;
  }

  private actorFor(order: Order, userId: string): OrderActor {
    if (userId === order.buyerId) return 'buyer';
    if (userId === order.sellerId) return 'seller';
    throw AppError.forbidden('You are not a party to this order');
  }

  private async resolveAcceptedOfferPrice(
    offerMessageId: string,
    listingId: string,
    buyerId: string,
  ): Promise<number> {
    const offer = await this.prisma.message.findUnique({
      where: { id: offerMessageId },
      include: { thread: true },
    });
    if (
      !offer ||
      offer.kind !== MessageKind.OFFER ||
      offer.offerStatus !== OfferStatus.ACCEPTED ||
      offer.offerMinor == null
    ) {
      throw AppError.validation('Offer is not an accepted offer');
    }
    if (offer.thread.listingId !== listingId) throw AppError.validation('Offer does not match this listing');
    // The buyer must be a participant of the offer thread.
    const part = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId: offer.threadId, userId: buyerId } },
    });
    if (!part) throw AppError.forbidden('You are not part of this offer');
    return offer.offerMinor;
  }
}
