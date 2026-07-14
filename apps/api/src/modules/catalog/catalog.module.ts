import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { CategoriesService } from './categories/categories.service';
import { CategoriesController } from './categories/categories.controller';
import { ListingsService } from './listings/listings.service';
import { ListingsController } from './listings/listings.controller';
import { MediaService } from './media/media.service';
import { MediaController } from './media/media.controller';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';

@Module({
  imports: [TrustModule],
  controllers: [CategoriesController, ListingsController, MediaController, SearchController],
  providers: [CategoriesService, ListingsService, MediaService, SearchService],
  exports: [CategoriesService, ListingsService],
})
export class CatalogModule {}
