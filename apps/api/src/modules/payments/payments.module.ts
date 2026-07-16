import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { RazorpayProvider } from './provider/razorpay.provider';
import { CashfreeProvider } from './provider/cashfree.provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayProvider, CashfreeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
