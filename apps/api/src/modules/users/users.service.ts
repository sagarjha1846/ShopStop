import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  memberSince: Date;
  trustScore: number;
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
