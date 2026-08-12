import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QuestionsService } from './questions/questions.service';
import { QuestionsController } from './questions/questions.controller';
import { CategoriesService } from './categories/categories.service';
import { CategoriesController } from './categories/categories.controller';
import { ListingsService } from './listings/listings.service';
import { ListingsController } from './listings/listings.controller';
import { VariantsController } from './listings/variants.controller';
import { MediaService } from './media/media.service';
import { MediaController } from './media/media.controller';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';
import { SavedSearchesService } from './saved-searches/saved-searches.service';
import { SavedSearchesController } from './saved-searches/saved-searches.controller';

@Module({
  imports: [TrustModule, PaymentsModule, NotificationsModule],
  controllers: [
    QuestionsController,
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
    MediaService,
    SearchService,
    SavedSearchesService,
    QuestionsService,
  ],
  exports: [CategoriesService, ListingsService],
})
export class CatalogModule {}
