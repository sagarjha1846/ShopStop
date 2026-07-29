import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { CategoriesService } from './categories/categories.service';
import { CategoriesController } from './categories/categories.controller';
import { ListingsService } from './listings/listings.service';
import { ViewCounterService } from './listings/view-counter.service';
import { ListingsController } from './listings/listings.controller';
import { VariantsController } from './listings/variants.controller';
import { MediaService } from './media/media.service';
import { MediaController } from './media/media.controller';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';
import { SavedSearchesService } from './saved-searches/saved-searches.service';
import { SavedSearchesController } from './saved-searches/saved-searches.controller';

@Module({
  imports: [TrustModule],
  controllers: [
    CategoriesController,
    ListingsController,
    VariantsController,
    MediaController,
    SearchController,
    SavedSearchesController,
  ],
  providers: [
    CategoriesService,
    ListingsService,
    ViewCounterService,
    MediaService,
    SearchService,
    SavedSearchesService,
  ],
  exports: [CategoriesService, ListingsService],
})
export class CatalogModule {}
