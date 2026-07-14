import { Injectable, Logger } from '@nestjs/common';
import { authenticator } from 'otplib';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AppConfigService } from '../../config/config.module';
import { MailService } from '../../mail/mail.service';
import { AppError } from '../../common/errors/app-error';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import type { AuthUser } from './types';

export interface AuthContext {
  ip?: string;
  userAgent?: string;
  deviceFingerprint?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
  ) {}

  // ---- Registration -------------------------------------------------------

  async register(dto: RegisterDto, ctx: AuthContext): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw AppError.conflict('An account with this email already exists');

    const passwordHash = await this.passwords.hash(dto.password);
    const handle = await this.generateHandle(dto.displayName ?? email.split('@')[0]!);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        profile: {
          create: {
            handle,
            displayName: dto.displayName?.trim() || handle,
          },
        },
        trustScore: { create: { score: 5 } }, // small baseline; grows with verification
      },
    });

    await this.sendEmailVerification(user.id, email);
    const tokens = await this.issueTokens(user, ctx);
    return { user: this.toAuthUser(user), tokens };
  }

  // ---- Login --------------------------------------------------------------

  async login(dto: LoginDto, ctx: AuthContext): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Constant-ish response to avoid user enumeration: verify against a dummy hash.
    if (!user || !user.passwordHash) {
      await this.passwords.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        dto.password,
      );
      throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      throw AppError.forbidden('This account is not permitted to sign in');
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw new AppError('UNAUTHENTICATED', 'Invalid email or password');

    if (user.mfaEnabled) {
      if (!dto.mfaCode) throw new AppError('UNAUTHENTICATED', 'MFA code required');
      const secret = user.mfaSecret ? this.decrypt(user.mfaSecret) : '';
      if (!authenticator.check(dto.mfaCode, secret)) {
        throw new AppError('UNAUTHENTICATED', 'Invalid MFA code');
      }
    }

    const tokens = await this.issueTokens(user, ctx);
    return { user: this.toAuthUser(user), tokens };
  }

  // ---- Refresh rotation + reuse detection ---------------------------------

  async refresh(refreshToken: string, ctx: AuthContext): Promise<TokenPair> {
    let payload;
    try {
      payload = await this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    }
    if (payload.type !== 'refresh') throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');

    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.expiresAt < new Date()) {
      throw new AppError('UNAUTHENTICATED', 'Session expired');
    }

    // Reuse detection: a revoked session being used, or a token whose hash no
    // longer matches the current one, means the token was stolen/replayed.
    const incomingHash = this.tokens.hashToken(refreshToken);
    if (session.revokedAt || session.refreshTokenHash !== incomingHash) {
      this.logger.warn(`Refresh reuse detected for user ${session.userId}; revoking family`);
      await this.revokeAllSessions(session.userId);
      throw new AppError('UNAUTHENTICATED', 'Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status === 'BANNED' || user.status === 'SUSPENDED') {
      await this.revokeAllSessions(session.userId);
      throw AppError.forbidden('Account not permitted');
    }

    // Rotate in place.
    const newRefresh = await this.tokens.signRefresh(user.id, session.id);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.tokens.hashToken(newRefresh),
        lastUsedAt: new Date(),
        ip: ctx.ip ?? session.ip,
        userAgent: ctx.userAgent ?? session.userAgent,
      },
    });
    const accessToken = await this.tokens.signAccess(this.toAuthUser(user));
    return { accessToken, refreshToken: newRefresh, expiresIn: this.config.get('JWT_ACCESS_TTL') };
  }

  async logout(sessionId: string | undefined, userId: string): Promise<void> {
    if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, userId },
        data: { revokedAt: new Date() },
      });
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revokeAllSessions(userId);
  }

  // ---- Phone OTP / email verification -------------------------------------

  async requestOtp(phone: string): Promise<void> {
    await this.otp.request(phone);
  }

  async verifyOtp(userId: string, phone: string, code: string): Promise<AuthUser> {
    const ok = await this.otp.verify(phone, code);
    if (!ok) throw AppError.validation('Invalid OTP code');

    // Enforce phone uniqueness across accounts (multi-account signal source).
    const taken = await this.prisma.user.findFirst({
      where: { phone, id: { not: userId } },
    });
    if (taken) throw AppError.conflict('This phone number is already in use');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerifiedAt: new Date() },
    });
    return this.toAuthUser(user);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.redis.get(`emailverify:${token}`);
    if (!userId) throw AppError.validation('Verification link is invalid or expired');
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.redis.del(`emailverify:${token}`);
  }

  // ---- Helpers ------------------------------------------------------------

  private async issueTokens(user: User, ctx: AuthContext): Promise<TokenPair> {
    const expiresAt = new Date(Date.now() + this.config.get('JWT_REFRESH_TTL') * 1000);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'pending',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        deviceFingerprint: ctx.deviceFingerprint,
        expiresAt,
      },
    });
    const refreshToken = await this.tokens.signRefresh(user.id, session.id);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.tokens.hashToken(refreshToken) },
    });
    const accessToken = await this.tokens.signAccess(this.toAuthUser(user));
    return { accessToken, refreshToken, expiresIn: this.config.get('JWT_ACCESS_TTL') };
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async sendEmailVerification(userId: string, email: string): Promise<void> {
    const token = this.tokens.randomToken();
    await this.redis.setEx(`emailverify:${token}`, userId, 60 * 60 * 24);
    await this.mail.sendEmailVerification(email, token);
  }

  private async generateHandle(seed: string): Promise<string> {
    const base = seed
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      const exists = await this.prisma.profile.findUnique({ where: { handle: candidate } });
      if (!exists) return candidate;
    }
    return `${base}${Date.now().toString().slice(-6)}`;
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      role: user.role,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
    };
  }

  // Placeholder envelope decryption for mfaSecret; real impl in crypto util (Phase 2).
  private decrypt(value: string): string {
    return value;
  }
}
