import { Module } from '@nestjs/common';
import { FunnelService } from './funnel.service';
import { FunnelController } from './funnel.controller';

@Module({
  controllers: [FunnelController],
  providers: [FunnelService],
  exports: [FunnelService],
})
export class AnalyticsModule {}
