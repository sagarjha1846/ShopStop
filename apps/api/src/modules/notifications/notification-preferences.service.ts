import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import {
  NOTIFICATION_CATEGORIES,
  type ChannelSet,
  categoryForType,
  findCategory,
  resolveChannels,
} from './notification-categories';

export interface EffectivePreference extends ChannelSet {
  category: string;
  label: string;
  description: string;
  locked: boolean;
}

export interface PreferenceUpdate {
  category: string;
  inApp?: boolean;
  email?: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every category with its effective settings — stored overrides layered on top
   * of the defaults. Categories the user has never touched have no row, so the
   * preference center always renders the full taxonomy rather than whatever
   * happens to be in the table.
   */
  async list(userId: string): Promise<EffectivePreference[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const byCategory = new Map(rows.map((r) => [r.category, r]));

    return NOTIFICATION_CATEGORIES.map((category) => ({
      category: category.key,
      label: category.label,
      description: category.description,
      locked: category.locked,
      ...resolveChannels(category, byCategory.get(category.key)),
    }));
  }

  /** Channels for one event type — the hot path used by NotificationsService.notify. */
  async channelsForType(userId: string, type: string): Promise<ChannelSet> {
    const key = categoryForType(type);
    if (!key) return resolveChannels(undefined);

    const category = findCategory(key);
    const override = await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category: key } },
    });
    return resolveChannels(category, override);
  }

  /**
   * Upsert a batch of preferences (the settings form saves in one call). Unknown
   * and locked categories are rejected rather than silently ignored, so a client
   * that thinks it disabled security email finds out that it didn't.
   */
  async update(userId: string, updates: PreferenceUpdate[]): Promise<EffectivePreference[]> {
    for (const u of updates) {
      const category = findCategory(u.category);
      if (!category) throw AppError.validation(`Unknown notification category: ${u.category}`);
      if (category.locked) {
        throw AppError.validation(`"${category.label}" notifications cannot be turned off`);
      }
    }

    await this.prisma.$transaction(
      updates.map((u) => {
        const defaults = findCategory(u.category)!.defaults;
        const inApp = u.inApp ?? defaults.inApp;
        const email = u.email ?? defaults.email;
        return this.prisma.notificationPreference.upsert({
          where: { userId_category: { userId, category: u.category } },
          create: { userId, category: u.category, inApp, email },
          update: { inApp, email },
        });
      }),
    );

    return this.list(userId);
  }
}
