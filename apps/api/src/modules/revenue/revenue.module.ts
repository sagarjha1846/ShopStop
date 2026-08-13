import { Module } from '@nestjs/common';
import { RevenueService } from './revenue.service';
import { PayablesService } from './payables.service';
import { RevenueController } from './revenue.controller';

@Module({
  controllers: [RevenueController],
  providers: [RevenueService, PayablesService],
  exports: [RevenueService, PayablesService],
})
export class RevenueModule {}
