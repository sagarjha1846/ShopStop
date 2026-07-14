import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/review.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user.id, dto);
  }

  @Public()
  @Get('user/:userId')
  forUser(@Param('userId') userId: string) {
    return this.reviews.listForUser(userId);
  }
}
