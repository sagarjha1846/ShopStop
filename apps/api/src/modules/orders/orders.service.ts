import { Injectable } from '@nestjs/common';
import { MessageKind, OfferStatus, OrderStatus, type Order, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
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
  // Platform take-rate in basis points. MVP: small facilitation fee; tune per docs/18.
  private static readonly PLATFORM_FEE_BPS = 200; // 2%

  constructor(private readonly prisma: PrismaService) {}

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
    const feeMinor = Math.round((subtotalMinor * OrdersService.PLATFORM_FEE_BPS) / 10_000);
    const totalMinor = subtotalMinor; // buyer pays subtotal; fee deducted from seller settlement (P2)

    const timeline: TimelineEntry[] = [
      { status: OrderStatus.PENDING, actor: 'buyer', at: new Date().toISOString() },
    ];

    return this.prisma.order.create({
      data: {
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        status: OrderStatus.PENDING,
        quantity,
        unitPriceMinor,
        subtotalMinor,
        discountMinor: 0,
        feeMinor,
        totalMinor,
        currency: listing.currency,
        shippingAddressId: dto.shippingAddressId,
        timeline: timeline as unknown as Prisma.InputJsonValue,
      },
    });
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
    const timeline = [
      ...(Array.isArray(order.timeline) ? (order.timeline as unknown as TimelineEntry[]) : []),
      { status: nextStatus, actor, at: new Date().toISOString(), note },
    ];

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
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
      return updated;
    });
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
