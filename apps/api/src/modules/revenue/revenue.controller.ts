import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RevenueService } from './revenue.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

@ApiTags('Revenue')
@Controller()
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  /** A seller's own earnings. Scoped to the caller — never takes a seller id. */
  @Get('me/earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.revenue.sellerEarnings(user.id);
  }

  /** Platform revenue. Admin-only: this is the company's P&L, not moderator data. */
  @Roles(UserRole.ADMIN)
  @Get('admin/revenue')
  summary(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.revenue.summary(days);
  }
}
