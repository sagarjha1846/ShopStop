import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { NotificationPreferencesService } from './notification-preferences.service';
import { CATEGORY_KEYS } from './notification-categories';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class PreferenceUpdateDto {
  @IsIn(CATEGORY_KEYS)
  category!: string;

  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

class UpdatePreferencesDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(CATEGORY_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => PreferenceUpdateDto)
  preferences!: PreferenceUpdateDto[];
}

@ApiTags('Notifications')
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly prefs: NotificationPreferencesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prefs.list(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.prefs.update(user.id, dto.preferences);
  }
}
