import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { UsersService } from './users.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(60) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @IsString() @MaxLength(160) locationText?: string;
  @IsOptional() @IsString() @MaxLength(512) avatarUrl?: string;
}

@ApiTags('Users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/profile')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch('me/profile')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  /** DSAR: export all personal data we hold (DPDP/GDPR right of access). */
  @Get('me/export')
  exportData(@CurrentUser() user: AuthUser) {
    return this.users.exportData(user.id);
  }

  /** DSAR: erase the account (anonymize PII, retain transaction records). */
  @Delete('me')
  deleteAccount(@CurrentUser() user: AuthUser) {
    return this.users.deleteAccount(user.id);
  }

  @Public()
  @Get('users/:handle')
  profile(@Param('handle') handle: string) {
    return this.users.getPublicProfile(handle);
  }

  @Post('users/:handle/follow')
  follow(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.users.follow(user.id, handle);
  }

  @Delete('users/:handle/follow')
  unfollow(@CurrentUser() user: AuthUser, @Param('handle') handle: string) {
    return this.users.unfollow(user.id, handle);
  }
}
