import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../../auth/decorators/public.decorator';

const toNum = (v?: string): number | undefined => (v === undefined || v === '' ? undefined : Number(v));

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  query(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('condition') condition?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
    @Query('minRating') minRating?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.search.search({
      q,
      categoryId,
      minPrice: toNum(minPrice),
      maxPrice: toNum(maxPrice),
      condition,
      verifiedOnly: verifiedOnly === 'true',
      minRating: toNum(minRating),
      offset: toNum(offset),
      limit: toNum(limit),
    });
  }

  @Public()
  @Get('autocomplete')
  autocomplete(@Query('q') q = '') {
    return this.search.autocomplete(q);
  }
}
