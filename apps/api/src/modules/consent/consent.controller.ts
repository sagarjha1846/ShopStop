import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn } from 'class-validator';
import { ConsentService, CONSENT_PURPOSES, type ConsentPurpose } from './consent.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class RecordConsentDto {
  @IsIn(CONSENT_PURPOSES as unknown as string[])
  purpose!: ConsentPurpose;

  @IsBoolean()
  granted!: boolean;
}

@ApiTags('Users')
@Controller()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('consents')
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordConsentDto) {
    return this.consent.record(user.id, dto.purpose, dto.granted);
  }

  @Get('me/consents')
  current(@CurrentUser() user: AuthUser) {
    return this.consent.current(user.id);
  }
}
