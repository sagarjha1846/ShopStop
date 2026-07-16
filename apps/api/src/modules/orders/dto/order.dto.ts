import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  listingId!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Accepted OFFER message id — prices the order at the agreed amount' })
  @IsOptional()
  @IsString()
  offerMessageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingAddressId?: string;

  @ApiPropertyOptional({ description: 'Optional coupon code to apply' })
  @IsOptional()
  @IsString()
  couponCode?: string;
}

export class OrderTransitionDto {
  @ApiProperty({ enum: ['accept', 'reject', 'cancel', 'pack', 'ship', 'deliver', 'return', 'refund'] })
  @IsString()
  action!: string;

  @ApiPropertyOptional({ description: 'Free-text tracking note until courier integration' })
  @IsOptional()
  @IsString()
  trackingNote?: string;
}
