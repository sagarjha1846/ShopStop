import { Module } from '@nestjs/common';
import { PaymentProvidersModule } from './provider/payment-providers.module';
import { RefundsModule } from './refunds.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { BoostsService } from './boosts.service';
import { BoostsController } from './boosts.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [OrdersModule, PaymentProvidersModule, RefundsModule],
  controllers: [PaymentsController, BoostsController, SubscriptionsController],
  providers: [PaymentsService, BoostsService, SubscriptionsService],
  exports: [PaymentsService, BoostsService, SubscriptionsService],
})
export class PaymentsModule {}
