import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Buffered view counting for listings.
 *
 * Counting a view used to be `UPDATE listings SET view_count = view_count + 1` on
 * every detail render. During a drop that is thousands of writes per second against
 * one row, and Postgres serialises writers per row — so the queue of view counters
 * ends up holding the very row that checkout needs to lock for its atomic stock
 * reservation. Browsing traffic would throttle buying traffic, which is exactly
 * backwards for a sale.
 *
 * Views are now accumulated in a Redis hash and folded into Postgres on an interval,
 * turning N writes on the hot row into one batched write per flush. View counts are
 * engagement telemetry, not money, so trading exactness for not blocking checkout is
 * the right call; the delivered number stays live because reads add the un-flushed
 * delta back on.
 */
@Injectable()
export class ViewCounterService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ViewCounterService.name);
  private timer?: NodeJS.Timeout;

  /** Hash of listingId -> views not yet folded into Postgres. */
  private static readonly PENDING_KEY = 'listing:views:pending';
  private static readonly FLUSH_INTERVAL_MS = 10_000;
  /** Cap rows per statement so one flush can't build an unbounded query. */
  private static readonly MAX_BATCH = 500;

  /**
   * Per-instance staging key. Owning a private key means a flush can take the whole
   * pending batch atomically without blocking writers, and a crashed instance's batch
   * is still recoverable by that instance on restart rather than silently lost.
   */
  private readonly batchKey = `listing:views:flushing:${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flush().catch((err) => this.logger.error(`View flush failed: ${String(err)}`));
    }, ViewCounterService.FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Drain the buffer on a graceful shutdown so a deploy doesn't drop counts. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush().catch((err) => this.logger.error(`Shutdown view flush failed: ${String(err)}`));
  }

  /**
   * Record one view. Returns the number of views for this listing not yet written to
   * Postgres, so a reader can present a live figure without waiting for a flush.
   * Never throws — a telemetry counter must not be able to fail a page render.
   */
  async record(listingId: string): Promise<number> {
    try {
      return await this.redis.client.hincrby(ViewCounterService.PENDING_KEY, listingId, 1);
    } catch (err) {
      this.logger.debug(`Could not record view for ${listingId}: ${String(err)}`);
      return 0;
    }
  }

  /** Un-flushed views for a listing, for read paths that don't record one. */
  async pendingFor(listingId: string): Promise<number> {
    try {
      const raw = await this.redis.client.hget(ViewCounterService.PENDING_KEY, listingId);
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Fold buffered views into Postgres. Returns the number of listings updated.
   * Safe to run concurrently across the fleet: each instance claims its own batch.
   */
  async flush(): Promise<number> {
    // Recover a batch this instance claimed but died before writing.
    let updated = await this.drainBatch();

    // Claim the current pending buffer. RENAME is atomic, so writers that arrive
    // mid-flush start a fresh buffer instead of having their counts swallowed.
    try {
      await this.redis.client.rename(ViewCounterService.PENDING_KEY, this.batchKey);
    } catch {
      return updated; // nothing pending
    }
    updated += await this.drainBatch();
    return updated;
  }

  /** Write whatever is in this instance's staging key, then clear it. */
  private async drainBatch(): Promise<number> {
    const counts = await this.redis.client.hgetall(this.batchKey);
    const entries = Object.entries(counts)
      .map(([id, delta]) => [id, Number(delta)] as const)
      .filter(([, delta]) => Number.isFinite(delta) && delta > 0);
    // Nothing staged — skip the DEL so the only delete that ever runs is the one
    // after a successful write. Also saves a round trip on every idle flush.
    if (entries.length === 0) return 0;

    for (let i = 0; i < entries.length; i += ViewCounterService.MAX_BATCH) {
      const chunk = entries.slice(i, i + ViewCounterService.MAX_BATCH);
      // One statement for every hot listing, instead of one per view.
      const values = Prisma.join(
        chunk.map(([id, delta]) => Prisma.sql`(${id}, ${delta}::int)`),
      );
      await this.prisma.$executeRaw`
        UPDATE "listings" AS l
           SET "view_count" = l."view_count" + v.delta
          FROM (VALUES ${values}) AS v(id, delta)
         WHERE l."id" = v.id
      `;
    }

    // Only drop the buffer once Postgres has it — a crash before this replays the
    // batch rather than losing it.
    await this.redis.client.del(this.batchKey);
    this.logger.debug(`Flushed views for ${entries.length} listing(s)`);
    return entries.length;
  }
}
