import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BoostsService } from './boosts.service';
import { BoostsController } from './boosts.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { RazorpayProvider } from './provider/razorpay.provider';
import { CashfreeProvider } from './provider/cashfree.provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, BoostsController, SubscriptionsController],
  providers: [PaymentsService, BoostsService, SubscriptionsService, RazorpayProvider, CashfreeProvider],
  exports: [PaymentsService, BoostsService, SubscriptionsService],
})
export class PaymentsModule {}
