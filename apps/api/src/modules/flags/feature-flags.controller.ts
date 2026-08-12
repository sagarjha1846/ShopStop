import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { FeatureFlagsService } from './feature-flags.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class SetFlagDto {
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('Admin')
@Controller('admin/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  list() {
    return this.flags.list();
  }

  /** Admin-only: these switches move money and gate a public content surface. */
  @Roles(UserRole.ADMIN)
  @Put(':key')
  set(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
    @Req() req: Request,
  ) {
    return this.flags.set(user.id, key, dto.enabled, req.ip);
  }
}
