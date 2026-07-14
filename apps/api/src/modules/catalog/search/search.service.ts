import { Injectable } from '@nestjs/common';
import { Condition, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SearchParams {
  q?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  limit?: number;
  offset?: number;
}

interface SearchRow {
  id: string;
  title: string;
  price_minor: number;
  currency: string;
  slug: string;
  seller_id: string;
  created_at: Date;
  rank: number;
}

/**
 * Postgres full-text search (docs/05, docs/17). Uses the generated `search_vector`
 * column + GIN index for ranked FTS, with structured filters. All user input is
 * parameterized via Prisma.sql (no string interpolation → injection-safe). Swaps
 * for OpenSearch behind this same service when relevance/latency demands it.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: SearchParams): Promise<{ items: unknown[]; nextOffset: number | null }> {
    const limit = Math.min(params.limit ?? 20, 50);
    const offset = Math.max(params.offset ?? 0, 0);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."deleted_at" IS NULL`,
      Prisma.sql`l."status" = 'ACTIVE'`,
    ];

    const hasQuery = !!params.q?.trim();
    if (hasQuery) {
      conditions.push(Prisma.sql`l."search_vector" @@ websearch_to_tsquery('simple', ${params.q})`);
    }
    if (params.categoryId) conditions.push(Prisma.sql`l."category_id" = ${params.categoryId}`);
    if (params.minPrice !== undefined) conditions.push(Prisma.sql`l."price_minor" >= ${params.minPrice}`);
    if (params.maxPrice !== undefined) conditions.push(Prisma.sql`l."price_minor" <= ${params.maxPrice}`);
    // Only accept a valid enum label (raw cast on junk would 500).
    if (params.condition && (Object.values(Condition) as string[]).includes(params.condition)) {
      conditions.push(Prisma.sql`l."condition" = ${params.condition}::"Condition"`);
    }
    if (params.verifiedOnly) {
      conditions.push(Prisma.sql`(u."email_verified_at" IS NOT NULL OR u."phone_verified_at" IS NOT NULL)`);
    }
    if (params.minRating !== undefined) conditions.push(Prisma.sql`p."rating_avg" >= ${params.minRating}`);

    const where = Prisma.join(conditions, ' AND ');
    const rank = hasQuery
      ? Prisma.sql`ts_rank(l."search_vector", websearch_to_tsquery('simple', ${params.q}))`
      : Prisma.sql`0`;
    const orderBy = hasQuery
      ? Prisma.sql`rank DESC, l."published_at" DESC NULLS LAST`
      : Prisma.sql`l."published_at" DESC NULLS LAST`;

    const rows = await this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT l."id", l."title", l."price_minor", l."currency", l."slug",
             l."seller_id", l."created_at", ${rank} AS rank
      FROM "listings" l
      JOIN "users" u ON u."id" = l."seller_id"
      LEFT JOIN "profiles" p ON p."user_id" = l."seller_id"
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit + 1} OFFSET ${offset}
    `);

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      priceMinor: r.price_minor,
      currency: r.currency,
      sellerId: r.seller_id,
    }));
    return { items: page, nextOffset: hasMore ? offset + limit : null };
  }

  /**
   * Autocomplete over active listing titles. Substring ILIKE (accelerated by the
   * trigram GIN index) is what users expect from a suggest box; prefix matches are
   * ranked first. LIKE wildcards in the term are escaped so a user's `%`/`_` can't
   * broaden the pattern.
   */
  async autocomplete(q: string): Promise<string[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
    const contains = `%${escaped}%`;
    const prefix = `${escaped}%`;
    const rows = await this.prisma.$queryRaw<{ title: string }[]>(Prisma.sql`
      SELECT l."title", bool_or(l."title" ILIKE ${prefix}) AS is_prefix
      FROM "listings" l
      WHERE l."status" = 'ACTIVE' AND l."deleted_at" IS NULL
        AND l."title" ILIKE ${contains}
      GROUP BY l."title"
      ORDER BY is_prefix DESC, l."title" ASC
      LIMIT 8
    `);
    return rows.map((r) => r.title);
  }
}
