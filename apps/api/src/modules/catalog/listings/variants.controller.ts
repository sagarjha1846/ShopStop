import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ListingsService } from './listings.service';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types';

class VariantDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsInt() @Min(0) quantity?: number;
}

@ApiTags('Listings')
@Controller('listings/:id/variants')
export class VariantsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  list(@Param('id') id: string) {
    return this.listings.listVariants(id);
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VariantDto) {
    return this.listings.addVariant(user.id, id, dto);
  }

  @Patch(':variantId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: VariantDto,
  ) {
    return this.listings.updateVariant(user.id, id, variantId, dto);
  }

  @Delete(':variantId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('variantId') variantId: string) {
    await this.listings.deleteVariant(user.id, id, variantId);
  }
}
