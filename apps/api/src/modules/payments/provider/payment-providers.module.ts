import { Module } from '@nestjs/common';
import { RazorpayProvider } from './razorpay.provider';
import { CashfreeProvider } from './cashfree.provider';

/**
 * The gateway adapters on their own, depending on nothing but config.
 *
 * Split out so refunds can reach a gateway without importing PaymentsModule:
 * payments depends on orders, and orders needs to refund a cancelled sale, so a
 * single payments module would close a cycle.
 */
@Module({
  providers: [RazorpayProvider, CashfreeProvider],
  exports: [RazorpayProvider, CashfreeProvider],
})
export class PaymentProvidersModule {}
