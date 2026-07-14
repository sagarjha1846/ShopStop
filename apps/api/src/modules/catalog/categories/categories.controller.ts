import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Full category tree with per-category attribute schemas (drives the sell form). */
  @Public()
  @Get()
  getTree() {
    return this.categories.getTree();
  }
}
