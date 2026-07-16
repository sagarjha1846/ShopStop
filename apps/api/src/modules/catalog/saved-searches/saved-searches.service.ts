import { Injectable } from '@nestjs/common';
import type { Prisma, SavedSearch } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppError } from '../../../common/errors/app-error';
import { SearchService, type SearchParams } from '../search/search.service';

@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  async create(userId: string, name: string, params: SearchParams): Promise<SavedSearch> {
    // Persist only the whitelisted search params (avoid storing junk/pagination).
    const clean: SearchParams = {
      q: params.q,
      categoryId: params.categoryId,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      condition: params.condition,
      verifiedOnly: params.verifiedOnly,
      minRating: params.minRating,
    };
    return this.prisma.savedSearch.create({
      data: { userId, name: name.trim().slice(0, 80) || 'Saved search', params: clean as unknown as Prisma.InputJsonValue },
    });
  }

  list(userId: string): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.savedSearch.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw AppError.notFound('Saved search');
  }

  /** Re-run a saved search on demand (Phase 2: a worker alerts on new matches). */
  async run(userId: string, id: string): Promise<{ items: unknown[]; nextOffset: number | null }> {
    const saved = await this.prisma.savedSearch.findFirst({ where: { id, userId } });
    if (!saved) throw AppError.notFound('Saved search');
    return this.search.search((saved.params ?? {}) as SearchParams);
  }
}
