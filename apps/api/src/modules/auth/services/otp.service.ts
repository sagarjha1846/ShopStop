import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { AppConfigService } from '../../../config/config.module';
import { RedisService } from '../../../redis/redis.service';
import { AppError } from '../../../common/errors/app-error';

/**
 * Phone OTP: 6-digit code, stored hashed in Redis with TTL + attempt limiting.
 * Dev mode logs the code; prod sends via SMS provider (adapter, Phase 2).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  private codeKey(phone: string): string {
    return `otp:code:${phone}`;
  }
  private attemptKey(phone: string): string {
    return `otp:attempts:${phone}`;
  }

  async request(phone: string): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttl = this.config.get('OTP_TTL_SEC');
    await this.redis.setEx(this.codeKey(phone), this.hash(code), ttl);
    await this.redis.del(this.attemptKey(phone));

    if (this.config.get('OTP_DEV_LOG')) {
      this.logger.warn(`[DEV] OTP for ${phone}: ${code}`);
    }
    // Prod: enqueue SMS send via provider adapter.
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const stored = await this.redis.get(this.codeKey(phone));
    if (!stored) throw AppError.validation('OTP expired or not requested');

    const attempts = Number((await this.redis.get(this.attemptKey(phone))) ?? '0');
    if (attempts >= OtpService.MAX_ATTEMPTS) {
      throw new AppError('RATE_LIMITED', 'Too many OTP attempts. Request a new code.');
    }

    if (this.hash(code) !== stored) {
      await this.redis.client.incr(this.attemptKey(phone));
      await this.redis.client.expire(this.attemptKey(phone), this.config.get('OTP_TTL_SEC'));
      return false;
    }

    await this.redis.del(this.codeKey(phone));
    await this.redis.del(this.attemptKey(phone));
    return true;
  }

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
