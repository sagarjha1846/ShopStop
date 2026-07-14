import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.module';

/**
 * Single shared ioredis connection: cache, rate-limit buckets, idempotency store,
 * OTP store. (BullMQ + Socket.IO adapter will create their own connections later.)
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  async ping(): Promise<boolean> {
    const res = await this.client.ping();
    return res === 'PONG';
  }

  /** Set a value with TTL (seconds). */
  async setEx(key: string, value: string, ttlSec: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSec);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
