import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AppError } from '../../../common/errors/app-error';

/** One attribute field definition, as stored in Category.attributeSchema.fields[]. */
export interface AttrField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  unit?: string;
}

export interface CategoryNode extends Pick<Category, 'id' | 'slug' | 'name' | 'icon' | 'sortOrder'> {
  attributeSchema: { fields?: AttrField[] };
  children: CategoryNode[];
}

const TREE_CACHE_KEY = 'categories:tree';
const TREE_CACHE_TTL = 300; // 5 min; categories change rarely

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Full active category tree (cached). Drives the sell form + browse nav. */
  async getTree(): Promise<CategoryNode[]> {
    const cached = await this.redis.get(TREE_CACHE_KEY);
    if (cached) return JSON.parse(cached) as CategoryNode[];

    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const tree = this.buildTree(all);
    await this.redis.setEx(TREE_CACHE_KEY, JSON.stringify(tree), TREE_CACHE_TTL);
    return tree;
  }

  async findByIdOrThrow(id: string): Promise<Category> {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat || !cat.isActive) throw AppError.notFound('Category');
    return cat;
  }

  /** Attribute field definitions for a category (empty if none defined). */
  getFields(category: Category): AttrField[] {
    const schema = (category.attributeSchema ?? {}) as { fields?: AttrField[] };
    return schema.fields ?? [];
  }

  /** Invalidate the cached tree after admin edits (Phase 5 admin catalog CRUD). */
  async invalidateTree(): Promise<void> {
    await this.redis.del(TREE_CACHE_KEY);
  }

  private buildTree(all: Category[]): CategoryNode[] {
    const byId = new Map<string, CategoryNode>();
    for (const c of all) {
      byId.set(c.id, {
        id: c.id,
        slug: c.slug,
        name: c.name,
        icon: c.icon,
        sortOrder: c.sortOrder,
        attributeSchema: (c.attributeSchema ?? {}) as { fields?: AttrField[] },
        children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const c of all) {
      const node = byId.get(c.id)!;
      if (c.parentId && byId.has(c.parentId)) {
        byId.get(c.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}
