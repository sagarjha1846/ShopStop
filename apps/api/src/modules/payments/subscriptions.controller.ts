import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentProvider as ProviderEnum } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from './subscriptions.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class SubscribeDto {
  @IsOptional()
  @IsEnum(ProviderEnum)
  provider?: ProviderEnum;
}

@ApiTags('Payments')
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** Public so pricing can be shown before sign-up. */
  @Public()
  @Get('subscriptions/plans')
  plans() {
    return this.subscriptions.plans();
  }

  @Post('subscriptions')
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.payments.purchaseSubscription(user.id, dto.provider ?? ProviderEnum.RAZORPAY);
  }

  @Get('me/subscription')
  async mine(@CurrentUser() user: AuthUser) {
    const sub = await this.subscriptions.current(user.id);
    return {
      plan: sub?.plan ?? 'FREE',
      status: sub?.status ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      listingsPerHour: await this.subscriptions.listingVelocityAllowance(user.id),
    };
  }

  @Delete('me/subscription')
  cancel(@CurrentUser() user: AuthUser) {
    return this.subscriptions.cancel(user.id);
  }
}
