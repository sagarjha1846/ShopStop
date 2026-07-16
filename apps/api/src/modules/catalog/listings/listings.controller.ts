import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';
import type { SellerListingAction } from './listing.state';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalAuth } from '../../auth/decorators/optional-auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AppError } from '../../../common/errors/app-error';
import type { AuthUser } from '../../auth/types';

@ApiTags('Listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  browse(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('categoryId') categoryId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('sort') sort?: 'recent' | 'price_asc' | 'price_desc',
  ) {
    return this.listings.list({
      cursor,
      limit: limit ? Number(limit) : undefined,
      categoryId,
      sellerId,
      sort,
    });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.listings.create(user.id, dto);
  }

  @OptionalAuth()
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.getPublic(id, user?.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateListingDto) {
    return this.listings.update(user.id, id, dto);
  }

  /** Lifecycle actions: publish | pause | resume | archive. */
  @Post(':id/actions/:action')
  @HttpCode(200)
  action(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('action') action: string) {
    const allowed: SellerListingAction[] = ['publish', 'pause', 'resume', 'archive'];
    if (!allowed.includes(action as SellerListingAction)) {
      throw AppError.validation(`Unknown action "${action}"`);
    }
    return this.listings.transition(user.id, id, action as SellerListingAction);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.duplicate(user.id, id);
  }

  /** Feature the listing at the top of browse for N days (owner only). */
  @Post(':id/boost')
  boost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { days?: number }) {
    return this.listings.boost(user.id, id, Number(body?.days) || 7);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.listings.softDelete(user.id, id);
  }
}
