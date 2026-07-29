import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CouponsModule } from '../coupons/coupons.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { InventoryService } from './inventory.service';
import { ReservationSweeper } from './reservation.sweeper';

@Module({
  imports: [NotificationsModule, CouponsModule],
  controllers: [OrdersController],
  providers: [OrdersService, InventoryService, ReservationSweeper],
  exports: [OrdersService, InventoryService],
})
export class OrdersModule {}
