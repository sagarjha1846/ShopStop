import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/config.module';
import type { AccessTokenPayload, RefreshTokenPayload } from '../types';
import type { User } from '@prisma/client';

/**
 * Issues short-lived access JWTs and opaque-ish refresh JWTs.
 * Refresh tokens are stored only as a SHA-256 hash in the Session table so a DB
 * leak can't be replayed; rotation + reuse detection live in AuthService.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async signAccess(user: Pick<User, 'id' | 'role'> & {
    emailVerified: boolean;
    phoneVerified: boolean;
  }): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      ev: user.emailVerified,
      pv: user.phoneVerified,
      type: 'access',
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL'),
    });
  }

  async signRefresh(userId: string, sessionId: string): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: userId,
      sid: sessionId,
      jti: randomBytes(16).toString('hex'),
      type: 'refresh',
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TTL'),
    });
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
    });
  }

  async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
    });
  }

  /** Deterministic hash of a refresh token for storage/lookup. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Random token for email verification / password reset flows. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }
}
