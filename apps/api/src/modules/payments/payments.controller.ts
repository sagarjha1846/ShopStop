import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaymentProvider as ProviderEnum } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../auth/types';

class CreateIntentDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsIn(Object.values(ProviderEnum))
  provider?: ProviderEnum;
}

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Idempotent()
  @Post('intent')
  @HttpCode(200)
  intent(@CurrentUser() user: AuthUser, @Body() dto: CreateIntentDto) {
    return this.payments.createIntent(dto.orderId, user.id, dto.provider ?? ProviderEnum.RAZORPAY);
  }

  /**
   * Gateway webhook. Public (no user auth) but signature-verified. Requires the RAW
   * body for HMAC — enabled via NestFactory rawBody + express.raw for this route.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody;
    if (!raw) throw AppError.validation('Missing raw request body');
    // Pass all headers; each provider reads its own signature/timestamp scheme.
    return this.payments.handleWebhook(provider, raw, req.headers);
  }
}
