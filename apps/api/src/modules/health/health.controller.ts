import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: is the process up? Used by the orchestrator to restart on hang. */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: are dependencies reachable? Used by LB/deploy smoke checks. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, boolean> }> {
    const checks = { database: false, redis: false };
    try {
      checks.database = await this.prisma.ping();
    } catch {
      checks.database = false;
    }
    try {
      checks.redis = await this.redis.ping();
    } catch {
      checks.redis = false;
    }
    const healthy = Object.values(checks).every(Boolean);
    return { status: healthy ? 'ok' : 'degraded', checks };
  }
}
