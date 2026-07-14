import { Module } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { DisputesService } from './disputes.service';
import { ModerationController } from './moderation.controller';

@Module({
  controllers: [ModerationController],
  providers: [ModerationService, DisputesService],
  exports: [ModerationService, DisputesService],
})
export class ModerationModule {}
