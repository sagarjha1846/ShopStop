import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Condition, ListingType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateListingDto {
  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiPropertyOptional({ enum: ListingType })
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @ApiProperty()
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ enum: Condition })
  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @ApiProperty({ description: 'Price in minor units (paise)' })
  @IsInt()
  @Min(0)
  @Max(100_000_000_00) // ₹10 crore ceiling; guards against overflow/typos
  priceMinor!: number;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  negotiable?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Category-specific values, validated against the schema' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Media storage keys from upload-url' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaKeys?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'true = publish (risk-checked); false/omitted = draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateListingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: Condition })
  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000_00)
  priceMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  negotiable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationText?: string;
}
