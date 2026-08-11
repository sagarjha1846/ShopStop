import { Injectable, Logger } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AppError } from '../../common/errors/app-error';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotifyProducer } from '../../jobs/notify.producer';
import { MailService } from '../../mail/mail.service';

export interface NotifyInput {
  userId: string;
  type: string; // order.update | offer.received | message.new | trust.badge | ...
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly prefs: NotificationPreferencesService,
    private readonly notifyQueue: NotifyProducer,
    private readonly mail: MailService,
  ) {}

  /**
   * Fan a notification out to the channels the user has left enabled.
   *
   * In-app: persisted + pushed live. Email: enqueued on the notify queue so the
   * SMTP round-trip stays off the request path. Returns the stored notification,
   * or null when the user has muted this category in-app.
   */
  async notify(input: NotifyInput): Promise<Notification | null> {
    const channels = await this.prefs.channelsForType(input.userId, input.type);

    let stored: Notification | null = null;
    if (channels.inApp) {
      stored = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
        },
      });
      this.realtime.emitNotification(input.userId, stored);
    }

    if (channels.email) await this.sendEmail(input);

    return stored;
  }

  /**
   * Queue the email copy. Only verified, active addresses are mailed: anyone can
   * type a stranger's address at registration, so emailing an unverified one
   * turns marketplace activity into a spam vector aimed at that stranger.
   */
  private async sendEmail(input: NotifyInput): Promise<void> {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: input.userId, deletedAt: null, emailVerifiedAt: { not: null } },
        select: { email: true },
      });
      if (!user) return;

      await this.notifyQueue.enqueueEmail(
        this.mail.renderNotification(user.email, {
          title: input.title,
          body: input.body,
          data: input.data,
        }),
      );
    } catch (err) {
      // Email is best-effort: a queue hiccup must not fail the caller's transaction.
      this.logger.warn(`Could not queue notification email: ${String(err)}`);
    }
  }

  async list(userId: string, unreadOnly = false): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId } });
      if (!exists) throw AppError.notFound('Notification');
    }
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: res.count };
  }
}
