import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { AppConfigService } from '../config/config.service';

/**
 * Socket.IO adapter that wires the Redis pub/sub adapter onto the ROOT io server,
 * so events fan out across multiple API instances (docs/17). If Redis is
 * unavailable the server still runs single-instance. Set via
 * app.useWebSocketAdapter(new RedisIoAdapter(app)) in main.ts.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterFactory?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connect(): Promise<void> {
    try {
      const config = this.app.get(AppConfigService);
      const pub = new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: true });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      this.adapterFactory = createAdapter(pub, sub);
      this.logger.log('Socket.IO Redis adapter ready');
    } catch (err) {
      this.logger.warn(`Redis adapter unavailable, running single-instance: ${String(err)}`);
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterFactory) server.adapter(this.adapterFactory);
    return server;
  }
}
