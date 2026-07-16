import { Injectable } from '@nestjs/common';
import { MessageKind, OfferStatus, type Message, type Thread } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { SendMessageDto, OfferActionDto } from './dto/message.dto';

export interface AcceptedOffer {
  messageId: string;
  amountMinor: number;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Push a freshly-created message to connected participants (realtime delivery). */
  private async broadcast(threadId: string, message: Message): Promise<void> {
    const ids = await this.participantIds(threadId);
    this.realtime.emitNewMessage(threadId, ids, message);
  }

  /** Find or create the buyer↔seller thread for a listing. Sellers can't open a thread on their own listing. */
  async startThread(listingId: string, buyerId: string): Promise<Thread> {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.sellerId === buyerId) throw AppError.validation('You cannot message yourself about your own listing');

    const existing = await this.prisma.thread.findFirst({
      where: {
        listingId,
        AND: [
          { participants: { some: { userId: buyerId } } },
          { participants: { some: { userId: listing.sellerId } } },
        ],
      },
    });
    if (existing) return existing;

    return this.prisma.thread.create({
      data: {
        listingId,
        participants: { create: [{ userId: buyerId }, { userId: listing.sellerId }] },
      },
    });
  }

  async listThreads(userId: string): Promise<unknown[]> {
    return this.prisma.thread.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        listing: { select: { id: true, title: true, priceMinor: true, currency: true } },
        participants: {
          include: {
            user: { select: { id: true, profile: { select: { handle: true, displayName: true, avatarUrl: true } } } },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: 50,
    });
  }

  async getMessages(
    threadId: string,
    userId: string,
    cursor?: string,
    limit = 30,
  ): Promise<{ items: Message[]; nextCursor: string | null }> {
    await this.assertParticipant(threadId, userId);
    const take = Math.min(limit, 50);
    const items = await this.prisma.message.findMany({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    // Mark read up to now.
    await this.prisma.threadParticipant.updateMany({
      where: { threadId, userId },
      data: { lastReadAt: new Date() },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  async sendMessage(threadId: string, senderId: string, dto: SendMessageDto): Promise<Message> {
    await this.assertParticipant(threadId, senderId);
    const kind = dto.kind ?? MessageKind.TEXT;

    if (kind === MessageKind.OFFER) {
      if (dto.offerMinor === undefined) throw AppError.validation('offerMinor is required for an OFFER');
    } else if (kind === MessageKind.TEXT) {
      if (!dto.body?.trim()) throw AppError.validation('Message body is required');
    } else if ((kind === MessageKind.IMAGE || kind === MessageKind.FILE) && !dto.mediaKey) {
      throw AppError.validation('mediaKey is required for image/file messages');
    }

    const message = await this.prisma.message.create({
      data: {
        threadId,
        senderId,
        kind,
        body: dto.body?.trim(),
        mediaKey: dto.mediaKey,
        offerMinor: kind === MessageKind.OFFER ? dto.offerMinor : null,
        offerStatus: kind === MessageKind.OFFER ? OfferStatus.OPEN : null,
      },
    });
    await this.prisma.thread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
    await this.broadcast(threadId, message);
    return message;
  }

  /**
   * Respond to an OPEN offer. Only a participant who is NOT the offer's sender may
   * accept/decline/counter (you can't accept your own offer). Returns the accepted
   * offer info so the caller (orders) can create an order at the agreed price.
   */
  async respondToOffer(messageId: string, userId: string, dto: OfferActionDto): Promise<AcceptedOffer | null> {
    const offer = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!offer || offer.kind !== MessageKind.OFFER) throw AppError.notFound('Offer');
    await this.assertParticipant(offer.threadId, userId);
    if (offer.senderId === userId) throw AppError.forbidden('You cannot respond to your own offer');
    if (offer.offerStatus !== OfferStatus.OPEN) throw AppError.illegalState('This offer is no longer open');

    if (dto.action === 'accept') {
      await this.prisma.message.update({ where: { id: messageId }, data: { offerStatus: OfferStatus.ACCEPTED } });
      await this.systemMessage(offer.threadId, `Offer of ${this.fmt(offer.offerMinor)} accepted`);
      return { messageId, amountMinor: offer.offerMinor ?? 0 };
    }
    if (dto.action === 'decline') {
      await this.prisma.message.update({ where: { id: messageId }, data: { offerStatus: OfferStatus.DECLINED } });
      await this.systemMessage(offer.threadId, `Offer of ${this.fmt(offer.offerMinor)} declined`);
      return null;
    }
    // counter: mark original countered, create a new OPEN offer from the responder.
    if (dto.counterMinor === undefined) throw AppError.validation('counterMinor is required to counter');
    await this.prisma.message.update({ where: { id: messageId }, data: { offerStatus: OfferStatus.COUNTERED } });
    const counter = await this.prisma.message.create({
      data: {
        threadId: offer.threadId,
        senderId: userId,
        kind: MessageKind.OFFER,
        offerMinor: dto.counterMinor,
        offerStatus: OfferStatus.OPEN,
      },
    });
    await this.prisma.thread.update({ where: { id: offer.threadId }, data: { lastMessageAt: new Date() } });
    await this.broadcast(offer.threadId, counter);
    return null;
  }

  async participantIds(threadId: string): Promise<string[]> {
    const parts = await this.prisma.threadParticipant.findMany({ where: { threadId }, select: { userId: true } });
    return parts.map((p) => p.userId);
  }

  // ---- helpers ----

  private async assertParticipant(threadId: string, userId: string): Promise<void> {
    const part = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!part) throw AppError.forbidden('You are not a participant in this conversation');
  }

  private async systemMessage(threadId: string, body: string): Promise<void> {
    // System messages use the first participant as a nominal sender to satisfy FK,
    // but are rendered as system notices client-side (kind=SYSTEM).
    const first = await this.prisma.threadParticipant.findFirst({ where: { threadId } });
    if (!first) return;
    const sys = await this.prisma.message.create({
      data: { threadId, senderId: first.userId, kind: MessageKind.SYSTEM, body },
    });
    await this.prisma.thread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
    await this.broadcast(threadId, sys);
  }

  private fmt(minor: number | null): string {
    return `₹${((minor ?? 0) / 100).toLocaleString('en-IN')}`;
  }
}
