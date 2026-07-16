import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { WishlistService } from './wishlist.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

class AddWishlistDto {
  @IsString()
  listingId!: string;
}

@ApiTags('Buyer')
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.wishlist.list(user.id);
  }

  @Get(':listingId')
  has(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.wishlist.has(user.id, listingId);
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: AddWishlistDto) {
    return this.wishlist.add(user.id, dto.listingId);
  }

  @Delete(':listingId')
  remove(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.wishlist.remove(user.id, listingId);
  }
}
