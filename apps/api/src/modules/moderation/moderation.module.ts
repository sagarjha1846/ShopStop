import { Module } from '@nestjs/common';
import { RefundsModule } from '../payments/refunds.module';
import { ModerationService } from './moderation.service';
import { DisputesService } from './disputes.service';
import { ModerationController } from './moderation.controller';

@Module({
  // Dispute refunds go back through the gateway that took the money, so the
  // resolution path needs the payments port.
  imports: [RefundsModule],
  controllers: [ModerationController],
  providers: [ModerationService, DisputesService],
  exports: [ModerationService, DisputesService],
})
export class ModerationModule {}
