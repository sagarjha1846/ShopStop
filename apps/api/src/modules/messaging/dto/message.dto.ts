import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageKind } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class StartThreadDto {
  @ApiProperty()
  @IsString()
  listingId!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ enum: MessageKind, default: MessageKind.TEXT })
  @IsOptional()
  @IsEnum(MessageKind)
  kind?: MessageKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ description: 'Media storage key for IMAGE/FILE messages' })
  @IsOptional()
  @IsString()
  mediaKey?: string;

  @ApiPropertyOptional({ description: 'Offer amount in minor units (required when kind=OFFER)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  offerMinor?: number;
}

export class OfferActionDto {
  @ApiProperty({ enum: ['accept', 'decline', 'counter'] })
  @IsString()
  action!: 'accept' | 'decline' | 'counter';

  @ApiPropertyOptional({ description: 'Counter amount in minor units (required when action=counter)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  counterMinor?: number;
}
