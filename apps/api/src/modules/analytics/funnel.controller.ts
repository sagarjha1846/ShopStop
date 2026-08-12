import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { FunnelService } from './funnel.service';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Revenue')
@Controller()
export class FunnelController {
  constructor(private readonly funnel: FunnelService) {}

  /** The PRD's success metrics against live data. Admin-only, like revenue. */
  @Roles(UserRole.ADMIN)
  @Get('admin/funnel')
  report(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.funnel.report(days);
  }
}
