import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BoostsService } from './boosts.service';
import { BoostsController } from './boosts.controller';
import { RazorpayProvider } from './provider/razorpay.provider';
import { CashfreeProvider } from './provider/cashfree.provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, BoostsController],
  providers: [PaymentsService, BoostsService, RazorpayProvider, CashfreeProvider],
  exports: [PaymentsService, BoostsService],
})
export class PaymentsModule {}
