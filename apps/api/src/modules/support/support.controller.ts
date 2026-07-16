import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SupportService } from './support.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(160) subject!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

const isStaff = (u: AuthUser) => u.role === UserRole.ADMIN || u.role === UserRole.MODERATOR;

@ApiTags('Buyer')
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('support')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user.id, dto.subject, dto.body);
  }

  @Get('support')
  listOwn(@CurrentUser() user: AuthUser) {
    return this.support.listOwn(user.id);
  }

  @Get('support/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.get(user.id, id, isStaff(user));
  }

  @Post('support/:id/reply')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.reply(user.id, id, dto.body, isStaff(user));
  }

  @Post('support/:id/close')
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.close(user.id, id, isStaff(user));
  }

  // ---- admin ----
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Get('admin/support')
  listOpen() {
    return this.support.listOpen();
  }
}
