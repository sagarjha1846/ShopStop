import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto, OrderTransitionDto } from './dto/order.dto';
import { ORDER_ACTIONS, type OrderAction } from './order.state';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../auth/types';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('role') role?: string) {
    return this.orders.list(user.id, role === 'seller' ? 'seller' : 'buyer');
  }

  @Idempotent()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(id, user.id);
  }

  @Post(':id/transition')
  transition(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OrderTransitionDto) {
    if (!ORDER_ACTIONS.includes(dto.action as OrderAction)) {
      throw AppError.validation(`Unknown order action "${dto.action}"`);
    }
    return this.orders.transition(id, user.id, dto.action as OrderAction, dto.trackingNote);
  }
}
