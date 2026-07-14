import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed wrapper over ConfigService — compile-time-safe access to env values.
 * Never read process.env directly; inject this instead.
 *
 * Kept in its OWN file (separate from config.module) so importing the service type
 * from other modules does not trigger ConfigModule.forRoot()'s env validation at
 * import time (which would break isolated unit tests).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProd(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
