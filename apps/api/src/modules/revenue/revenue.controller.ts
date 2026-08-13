import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsString, Length } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { RevenueService } from './revenue.service';
import { PayablesService } from './payables.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class SettleDto {
  @IsString()
  sellerId!: string;

  /**
   * The real-world handle for the transfer — a bank UTR, a payout batch id.
   * Required, and not defaulted: a PAYOUT row that cannot be traced to money
   * leaving an account is worse than no row at all.
   */
  @IsString()
  @Length(3, 128)
  reference!: string;
}

@ApiTags('Revenue')
@Controller()
export class RevenueController {
  constructor(
    private readonly revenue: RevenueService,
    private readonly payables: PayablesService,
  ) {}

  /** A seller's own earnings. Scoped to the caller — never takes a seller id. */
  @Get('me/earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.revenue.sellerEarnings(user.id);
  }

  /**
   * What the caller is owed and what has been paid to them. Scoped to the caller —
   * never takes a seller id, since one seller's payout history is not another's.
   */
  @Get('me/payouts')
  myPayouts(@CurrentUser() user: AuthUser) {
    return this.payables.forSeller(user.id);
  }

  /** Platform revenue. Admin-only: this is the company's P&L, not moderator data. */
  @Roles(UserRole.ADMIN)
  @Get('admin/revenue')
  summary(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.revenue.summary(days);
  }

  /**
   * What the platform owes sellers. The other side of the revenue report: revenue
   * is what we keep, this is what we are holding that is not ours.
   */
  @Roles(UserRole.ADMIN)
  @Get('admin/payables')
  payablesReport(@Query('sellers', new DefaultValuePipe(20), ParseIntPipe) sellers: number) {
    return this.payables.report(sellers);
  }

  /**
   * Record a settlement paid to a seller out-of-band. Writes the PAYOUT ledger
   * rows that take the money out of the held balance. Idempotency-keyed, because
   * a retried request must not pay twice.
   */
  @Roles(UserRole.ADMIN)
  @Idempotent()
  @Post('admin/payables/settle')
  settle(@CurrentUser() user: AuthUser, @Body() dto: SettleDto, @Req() req: Request) {
    return this.payables.settle(dto.sellerId, dto.reference, user.id, req.ip);
  }
}
