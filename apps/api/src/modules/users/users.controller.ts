import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

@ApiTags('Users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me/profile')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
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
