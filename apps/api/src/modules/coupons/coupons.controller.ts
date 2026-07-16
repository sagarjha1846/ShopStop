import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CouponType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CouponsService } from './coupons.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

export class CreateCouponDto {
  @IsString()
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'code must be alphanumeric' })
  code!: string;

  @IsEnum(CouponType)
  type!: CouponType;

  @IsInt()
  @Min(1)
  value!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  platformWide?: boolean;
}

@ApiTags('Seller')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.coupons.listOwn(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCouponDto) {
    return this.coupons.create(user.id, user.role, dto);
  }
}
