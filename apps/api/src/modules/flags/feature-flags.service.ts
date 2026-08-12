import { Injectable, Logger } from '@nestjs/common';
import type { FeatureFlag, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';

/**
 * Flags the business is expected to operate, with their default when unset.
 *
 * Declared here rather than created ad hoc so the admin screen can list every
 * switch that exists — including ones nobody has touched yet — and so a typo in a
 * flag key can't silently evaluate to "off" somewhere important.
 */
export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const FLAG_SPECS: readonly FlagSpec[] = [
  {
    key: 'monetization.commission',
    label: 'Charge commission on orders',
    description:
      'Off means orders price at a 0% take rate. Lets the launch phase run free of transaction fees without a redeploy (docs/18 R5).',
    defaultEnabled: true,
  },
  {
    key: 'listings.questions',
    label: 'Public Q&A on listings',
    description: 'Kill switch for the public question surface if it needs to be closed quickly.',
    defaultEnabled: true,
  },
];

const CACHE_TTL_MS = 30_000;

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  /**
   * Flags are read on hot paths (every order priced, every question asked), so
   * they are cached rather than fetched per call. The TTL means a change can take
   * up to 30s to reach every instance — acceptable for operational switches, and
   * writes clear this instance immediately.
   */
  private cache = new Map<string, { enabled: boolean; payload: Prisma.JsonValue; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private spec(key: string): FlagSpec | undefined {
    return FLAG_SPECS.find((f) => f.key === key);
  }

  /**
   * Is this flag on? Unknown or unset flags fall back to their declared default,
   * and an unreachable database falls back too — a flag lookup failing must never
   * be the reason a request fails.
   */
  async isEnabled(key: string): Promise<boolean> {
    const fallback = this.spec(key)?.defaultEnabled ?? false;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.enabled;

    try {
      const row = await this.prisma.featureFlag.findUnique({ where: { key } });
      const enabled = row?.enabled ?? fallback;
      this.cache.set(key, { enabled, payload: row?.payload ?? {}, at: Date.now() });
      return enabled;
    } catch (err) {
      this.logger.warn(`Flag lookup failed for ${key}, using default ${fallback}: ${String(err)}`);
      return fallback;
    }
  }

  /** Every declared flag with its effective state, for the admin screen. */
  async list(): Promise<Array<FlagSpec & { enabled: boolean; updatedAt: Date | null }>> {
    const rows = await this.prisma.featureFlag.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return FLAG_SPECS.map((spec) => ({
      ...spec,
      enabled: byKey.get(spec.key)?.enabled ?? spec.defaultEnabled,
      updatedAt: byKey.get(spec.key)?.updatedAt ?? null,
    }));
  }

  /**
   * Flip a flag. Audited because these switches move money and moderation
   * surfaces: "who turned commission off, and when" has to be answerable.
   */
  async set(actorId: string, key: string, enabled: boolean, ip?: string): Promise<FeatureFlag> {
    // A validation error, not a 500: an unknown key is bad input, and returning a
    // server error for it would hide a client typo behind an ops alert.
    if (!this.spec(key)) throw AppError.validation(`Unknown feature flag: ${key}`);

    const flag = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled },
      update: { enabled },
    });
    this.cache.delete(key);

    await this.audit.record({
      actorId,
      action: `feature_flag.${enabled ? 'enabled' : 'disabled'}`,
      targetType: 'FEATURE_FLAG',
      targetId: key,
      ip,
      meta: { key, enabled },
    });
    this.logger.log(`Feature flag ${key} set to ${enabled} by ${actorId}`);
    return flag;
  }
}
