import { Injectable } from '@nestjs/common';
import { MessageKind, OfferStatus, OrderStatus, type Order, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { CouponsService } from '../coupons/coupons.service';
import { TrustScoreService } from '../trust/trust-score.service';
import { InventoryService } from './inventory.service';
import { resolveTransition, type OrderAction, type OrderActor } from './order.state';
import type { CreateOrderDto } from './dto/order.dto';

interface TimelineEntry {
  status: OrderStatus;
  actor: OrderActor;
  at: string;
  note?: string;
}

/**
 * States in which the sale is off and the buyer's units go back on the market.
 * REFUNDED covers the returned-goods path too — a returned item is sellable again.
 */
const RELEASING_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.REFUNDED,
]);

@Injectable()
export class OrdersService {
  // Platform take-rate in basis points. MVP: small facilitation fee; tune per docs/18.
  private static readonly PLATFORM_FEE_BPS = 200; // 2%

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly coupons: CouponsService,
    private readonly trust: TrustScoreService,
    private readonly inventory: InventoryService,
  ) {}

  async create(buyerId: string, dto: CreateOrderDto): Promise<Order> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: dto.listingId, deletedAt: null },
    });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.status !== 'ACTIVE')
      throw AppError.illegalState('This listing is not available for purchase');
    if (listing.sellerId === buyerId) throw AppError.validation('You cannot buy your own listing');

    const quantity = dto.quantity ?? 1;
    // Cheap pre-check for a friendly error. It is NOT the guard — the authoritative
    // check is the atomic reservation below, which is what holds under a stampede.
    if (quantity > listing.quantity)
      throw AppError.conflict('Not enough stock left for this listing');

    // Price: an accepted offer (owned by this buyer, on this listing) overrides list price.
    let unitPriceMinor = listing.priceMinor;
    if (dto.offerMessageId) {
      unitPriceMinor = await this.resolveAcceptedOfferPrice(
        dto.offerMessageId,
        dto.listingId,
        buyerId,
      );
    }

    const subtotalMinor = unitPriceMinor * quantity;

    // Optional coupon: validate + reserve a redemption; discount capped at subtotal.
    let discountMinor = 0;
    let couponId: string | undefined;
    if (dto.couponCode?.trim()) {
      const applied = await this.coupons.validateAndReserve(
        dto.couponCode,
        listing.sellerId,
        subtotalMinor,
      );
      discountMinor = applied.discountMinor;
      couponId = applied.couponId;
    }

    const feeMinor = Math.round(
      ((subtotalMinor - discountMinor) * OrdersService.PLATFORM_FEE_BPS) / 10_000,
    );
    const totalMinor = subtotalMinor - discountMinor; // buyer pays subtotal minus discount

    const timeline: TimelineEntry[] = [
      { status: OrderStatus.PENDING, actor: 'buyer', at: new Date().toISOString() },
    ];

    try {
      // Reserve stock and write the order in one transaction. If either half fails the
      // other is rolled back, so an order never exists without its units and units are
      // never held without an order.
      return await this.prisma.$transaction(async (tx) => {
        const reserved = await this.inventory.reserve(tx, listing.id, quantity);
        if (!reserved) throw AppError.conflict('Not enough stock left for this listing');

        return tx.order.create({
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
            stockHeld: true,
            reservationExpiresAt: InventoryService.reservationDeadline(),
            timeline: timeline as unknown as Prisma.InputJsonValue,
          },
        });
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
      include: {
        listing: { select: { id: true, title: true } },
        payment: { select: { status: true } },
      },
      take: 100,
    });
  }

  /** Apply a lifecycle transition, authorizing by the caller's role on the order. */
  async transition(
    orderId: string,
    userId: string,
    action: OrderAction,
    note?: string,
  ): Promise<Order> {
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

      // Inventory. Units were already reserved at checkout, so ACCEPTED does not
      // decrement again — it only makes the hold permanent by dropping its expiry.
      if (nextStatus === OrderStatus.ACCEPTED) {
        await this.inventory.confirmHold(tx, order.id);
      }

      // Any terminal state that undoes the sale returns the units. `releaseOrderHold`
      // is guarded on `stock_held`, so a double-cancel or a replayed refund webhook
      // moves stock exactly once.
      if (RELEASING_STATUSES.has(nextStatus)) {
        await this.inventory.releaseOrderHold(tx, order);
      }
      return row;
    });

    // Give back the coupon redemption if the order is abandoned before fulfilment.
    if (
      (nextStatus === OrderStatus.CANCELLED || nextStatus === OrderStatus.REJECTED) &&
      order.couponId
    ) {
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
    if (offer.thread.listingId !== listingId)
      throw AppError.validation('Offer does not match this listing');
    // The buyer must be a participant of the offer thread.
    const part = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId: offer.threadId, userId: buyerId } },
    });
    if (!part) throw AppError.forbidden('You are not part of this offer');
    return offer.offerMinor;
  }
}
