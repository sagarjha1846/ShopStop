import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { publicTrustFactors, type TrustContribution } from '../trust/trust-factors';

export type { TrustContribution };

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  memberSince: Date;
  trustScore: number;
  /** Positive trust contributions, most impactful first. Internal risk penalties are withheld. */
  trustFactors: TrustContribution[];
  badges: string[];
  ratingAvg: number;
  ratingCount: number;
  completedSales: number;
  responseMins: number | null;
  followerCount: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public trust panel for a user (docs/04). Never leaks email/phone/PII. */
  async getPublicProfile(handle: string): Promise<PublicProfile> {
    const profile = await this.prisma.profile.findUnique({
      where: { handle },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            trustScore: true,
            verification: { select: { status: true } },
            sellerVerif: { select: { status: true } },
          },
        },
      },
    });
    if (!profile || profile.user.status === 'BANNED') throw AppError.notFound('User');

    const badges: string[] = [];
    if (profile.user.emailVerifiedAt) badges.push('EMAIL');
    if (profile.user.phoneVerifiedAt) badges.push('PHONE');
    if (profile.user.verification?.status === 'VERIFIED') badges.push('IDENTITY');
    if (profile.user.sellerVerif?.status === 'VERIFIED') badges.push('BUSINESS');

    return {
      id: profile.user.id,
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      memberSince: profile.memberSince,
      trustScore: profile.user.trustScore?.score ?? 0,
      trustFactors: publicTrustFactors(profile.user.trustScore?.factors),
      badges,
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
      completedSales: profile.completedSales,
      responseMins: profile.responseMins,
      followerCount: profile.followerCount,
    };
  }

  /** Full self view (includes verification state the owner may act on). */
  async getMe(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
        profile: true,
        trustScore: { select: { score: true, fraudScore: true } },
      },
    });
    if (!user) throw AppError.notFound('User');
    return {
      ...user,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
    };
  }

  /** Update the caller's own profile (display name, bio, location, avatar). */
  async updateProfile(
    userId: string,
    dto: { displayName?: string; bio?: string; locationText?: string; avatarUrl?: string },
  ): Promise<unknown> {
    await this.prisma.profile.update({
      where: { userId },
      data: {
        displayName: dto.displayName?.trim(),
        bio: dto.bio?.trim(),
        locationText: dto.locationText?.trim(),
        avatarUrl: dto.avatarUrl,
      },
    });
    return this.getMe(userId);
  }

  /**
   * DSAR data export (DPDP Act / GDPR right of access, docs/01, docs/11). Returns
   * the personal data we hold for the user as a JSON bundle.
   */
  async exportData(userId: string): Promise<unknown> {
    const [user, listings, ordersBuyer, ordersSeller, reviews, addresses, wishlist, notifications, consents, messages] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, phone: true, createdAt: true, profile: true, trustScore: true },
        }),
        this.prisma.listing.findMany({ where: { sellerId: userId }, select: { id: true, title: true, status: true, priceMinor: true, createdAt: true } }),
        this.prisma.order.findMany({ where: { buyerId: userId }, select: { id: true, status: true, totalMinor: true, createdAt: true } }),
        this.prisma.order.findMany({ where: { sellerId: userId }, select: { id: true, status: true, totalMinor: true, createdAt: true } }),
        this.prisma.review.findMany({ where: { authorId: userId }, select: { id: true, rating: true, body: true, createdAt: true } }),
        this.prisma.address.findMany({ where: { userId } }),
        this.prisma.wishlistItem.findMany({ where: { userId }, select: { listingId: true, createdAt: true } }),
        this.prisma.notification.findMany({ where: { userId }, select: { type: true, title: true, createdAt: true } }),
        this.prisma.consent.findMany({ where: { userId } }),
        this.prisma.message.findMany({ where: { senderId: userId }, select: { id: true, threadId: true, kind: true, body: true, createdAt: true }, take: 5000 }),
      ]);
    return {
      exportedAt: new Date().toISOString(),
      user,
      listings,
      orders: { asBuyer: ordersBuyer, asSeller: ordersSeller },
      reviews,
      addresses,
      wishlist,
      notifications,
      consents,
      messages,
    };
  }

  /**
   * DSAR erasure (right to be forgotten). Anonymizes PII and deactivates the account
   * while retaining transaction records (orders/ledger) the counterparty and law
   * require. Messages are redacted. Sessions revoked; active listings removed.
   */
  async deleteAccount(userId: string): Promise<{ deleted: true }> {
    const anon = `deleted-${userId.slice(-8)}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `${anon}@deleted.local`,
          phone: null,
          passwordHash: null,
          mfaEnabled: false,
          mfaSecret: null,
          status: 'BANNED', // blocks sign-in; no dedicated DELETED status
          deletedAt: new Date(),
        },
      });
      await tx.profile.updateMany({
        where: { userId },
        data: { displayName: 'Deleted user', bio: null, avatarUrl: null, locationText: null, lat: null, lng: null },
      });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.listing.updateMany({
        where: { sellerId: userId, status: { in: ['ACTIVE', 'PENDING_REVIEW', 'PAUSED', 'DRAFT'] } },
        data: { status: 'ARCHIVED', deletedAt: new Date() },
      });
      await tx.message.updateMany({ where: { senderId: userId }, data: { body: '[deleted]', deletedAt: new Date() } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.wishlistItem.deleteMany({ where: { userId } });
    });
    return { deleted: true };
  }

  async follow(followerId: string, handle: string): Promise<{ following: boolean }> {
    const target = await this.prisma.profile.findUnique({ where: { handle }, select: { userId: true } });
    if (!target) throw AppError.notFound('User');
    if (target.userId === followerId) throw AppError.validation('You cannot follow yourself');
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.follow
        .create({ data: { followerId, followeeId: target.userId } })
        .catch(() => null);
      if (created) {
        await tx.profile.updateMany({ where: { userId: target.userId }, data: { followerCount: { increment: 1 } } });
      }
    });
    return { following: true };
  }

  async unfollow(followerId: string, handle: string): Promise<{ following: boolean }> {
    const target = await this.prisma.profile.findUnique({ where: { handle }, select: { userId: true } });
    if (!target) throw AppError.notFound('User');
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({
        where: { followerId, followeeId: target.userId },
      });
      if (deleted.count > 0) {
        await tx.profile.updateMany({
          where: { userId: target.userId, followerCount: { gt: 0 } },
          data: { followerCount: { decrement: 1 } },
        });
      }
    });
    return { following: false };
  }
}
