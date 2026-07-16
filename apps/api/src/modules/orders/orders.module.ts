import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CouponsModule } from '../coupons/coupons.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [NotificationsModule, CouponsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
