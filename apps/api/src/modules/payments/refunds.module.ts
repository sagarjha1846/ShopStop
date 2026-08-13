import { Module } from '@nestjs/common';
import { PaymentProvidersModule } from './provider/payment-providers.module';
import { RefundsService } from './refunds.service';

/**
 * Refunds stand apart from PaymentsModule on purpose. Payments depends on orders
 * (to mark an order paid on capture), and orders needs to refund a cancelled sale,
 * so hanging refunds off PaymentsModule would close a module cycle. Depending only
 * on the gateway adapters keeps every caller — orders, moderation, payments — able
 * to reach the same single refund path.
 */
@Module({
  imports: [PaymentProvidersModule],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
