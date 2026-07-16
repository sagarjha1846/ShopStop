import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SavedSearchesService } from './saved-searches.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types';

class SaveSearchDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsInt() minPrice?: number;
  @IsOptional() @IsInt() maxPrice?: number;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsBoolean() verifiedOnly?: boolean;
  @IsOptional() @IsNumber() minRating?: number;
}

@ApiTags('Buyer')
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly saved: SavedSearchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.saved.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveSearchDto) {
    const { name, ...params } = dto;
    return this.saved.create(user.id, name, params);
  }

  @Get(':id/run')
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.saved.run(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.saved.remove(user.id, id);
  }
}
