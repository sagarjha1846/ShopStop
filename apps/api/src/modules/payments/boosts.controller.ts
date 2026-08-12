import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentProvider as ProviderEnum } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentsService } from './payments.service';
import { BoostsService } from './boosts.service';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class BuyBoostDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;

  @IsOptional()
  @IsEnum(ProviderEnum)
  provider?: ProviderEnum;
}

/**
 * Sponsored placement is a paid product, so it is bought through the payment
 * service rather than granted by the catalog. Lives here (not in ListingsController)
 * so the money path stays in one module.
 */
@ApiTags('Payments')
@Controller()
export class BoostsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly boosts: BoostsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** Current boost pricing, plus any plan credit the caller can spend first. */
  @Get('boosts/pricing')
  async pricing(@CurrentUser() user: AuthUser) {
    const perDay = this.boosts.pricePerDayMinor();
    return {
      currency: 'INR',
      pricePerDayMinor: perDay,
      maxDays: 30,
      includedDaysRemaining: await this.subscriptions.boostDaysRemaining(user.id),
      examples: [7, 14, 30].map((days) => ({ days, amountMinor: this.boosts.quoteMinor(days) })),
    };
  }

  /** Buy sponsored placement. The boost activates on payment capture, not here. */
  @Post('listings/:id/boost')
  buy(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BuyBoostDto) {
    return this.payments.purchaseBoost(user.id, id, dto.days ?? 7, dto.provider ?? ProviderEnum.RAZORPAY);
  }

  @Get('me/boosts')
  mine(@CurrentUser() user: AuthUser) {
    return this.boosts.listForSeller(user.id);
  }
}
