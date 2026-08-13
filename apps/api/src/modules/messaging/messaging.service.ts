import { Injectable } from '@nestjs/common';
import { MessageKind, OfferStatus, Prisma, type Message, type Thread } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
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

  /**
   * Inbox, with per-thread unread counts and the counterparty's read position.
   *
   * Both come from ThreadParticipant.lastReadAt, which the app has always written
   * and never read back — so the data to answer "did they see it?" existed all
   * along and simply wasn't surfaced.
   */
  async listThreads(userId: string): Promise<unknown[]> {
    const threads = await this.prisma.thread.findMany({
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

    // Every new user has an empty inbox, and Prisma.join on an empty list builds
    // invalid SQL — so bail before the query rather than 500 on the common case.
    if (threads.length === 0) return [];

    // One grouped query rather than a count per thread: 50 threads should not
    // mean 50 round trips.
    const counts = await this.prisma.$queryRaw<Array<{ thread_id: string; unread: bigint }>>`
      SELECT t.id AS thread_id,
             COUNT(m.id) FILTER (
               WHERE m.sender_id <> ${userId}
                 AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
             ) AS unread
      FROM threads t
      JOIN thread_participants tp ON tp.thread_id = t.id AND tp.user_id = ${userId}
      LEFT JOIN messages m ON m.thread_id = t.id AND m.deleted_at IS NULL
      WHERE t.id IN (${Prisma.join(threads.map((t) => t.id))})
      GROUP BY t.id
    `;
    const unreadByThread = new Map(counts.map((c) => [c.thread_id, Number(c.unread)]));

    return threads.map((t) => ({
      ...t,
      unreadCount: unreadByThread.get(t.id) ?? 0,
      // How far the *other* side has read — this is the read receipt.
      counterpartyLastReadAt:
        t.participants.find((p) => p.userId !== userId)?.lastReadAt ?? null,
    }));
  }

  async getMessages(
    threadId: string,
    userId: string,
    cursor?: string,
    limit = 30,
  ): Promise<{ items: Message[]; nextCursor: string | null; counterpartyLastReadAt: Date | null }> {
    await this.assertParticipant(threadId, userId);
    const take = Math.min(limit, 50);
    const items = await this.prisma.message.findMany({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    // Mark read up to now, and tell the other side — but only when the position
    // actually moved, so paging back through history doesn't spam the room.
    const readAt = new Date();
    const advanced = await this.prisma.threadParticipant.updateMany({
      where: { threadId, userId, OR: [{ lastReadAt: null }, { lastReadAt: { lt: readAt } }] },
      data: { lastReadAt: readAt },
    });
    if (advanced.count > 0) this.realtime.emitThreadRead(threadId, userId, readAt);

    const participants = await this.prisma.threadParticipant.findMany({ where: { threadId } });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
      items: page,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      counterpartyLastReadAt: participants.find((p) => p.userId !== userId)?.lastReadAt ?? null,
    };
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

    // Notify the other participant(s) — inbox + push even if they're offline.
    const ids = await this.participantIds(threadId);
    for (const uid of ids.filter((u) => u !== senderId)) {
      await this.notifications
        .notify({
          userId: uid,
          type: kind === MessageKind.OFFER ? 'offer.received' : 'message.new',
          title: kind === MessageKind.OFFER ? `New offer: ${this.fmt(dto.offerMinor ?? 0)}` : 'New message',
          body: kind === MessageKind.TEXT ? dto.body?.slice(0, 120) : undefined,
          data: { threadId },
        })
        .catch(() => undefined);
    }
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
