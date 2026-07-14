import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { RazorpayProvider } from './provider/razorpay.provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
