import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DisputeStatus, ReportSubject, UserRole } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ModerationService } from './moderation.service';
import { DisputesService } from './disputes.service';
import { CreateReportDto, ModerationActionDto } from './dto/moderation.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class OpenDisputeDto {
  @IsString()
  orderId!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence?: string[];
}

class ResolveDisputeDto {
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;

  @IsString()
  @MaxLength(1000)
  resolution!: string;
}

@ApiTags('Trust & Safety')
@Controller()
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly disputes: DisputesService,
  ) {}

  // ---- reports (any authed user) ----
  @Post('reports')
  report(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.moderation.createReport(user.id, dto);
  }

  // ---- disputes ----
  @Post('disputes')
  openDispute(@CurrentUser() user: AuthUser, @Body() dto: OpenDisputeDto) {
    return this.disputes.open(user.id, dto.orderId, dto.reason, dto.evidence);
  }

  @Get('disputes/:id')
  getDispute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.get(user.id, id, user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR);
  }

  // ---- admin console ----
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Get('admin/moderation/queue')
  queue() {
    return this.moderation.getQueue();
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Post('admin/moderation/:subjectType/:id/action')
  act(
    @CurrentUser() user: AuthUser,
    @Param('subjectType') subjectType: ReportSubject,
    @Param('id') id: string,
    @Body() dto: ModerationActionDto,
    @Req() req: Request,
  ) {
    return this.moderation.act(user.id, subjectType, id, dto, req.ip);
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Post('admin/fraud/:id/:status')
  resolveFraud(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('status') status: 'CONFIRMED' | 'FALSE_POSITIVE',
    @Req() req: Request,
  ) {
    return this.moderation.resolveFraudEvent(user.id, id, status, req.ip);
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Get('admin/disputes')
  openDisputes() {
    return this.disputes.listOpen();
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Post('admin/disputes/:id/resolve')
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @Req() req: Request,
  ) {
    return this.disputes.resolve(user.id, id, dto.status, dto.resolution, req.ip);
  }
}
