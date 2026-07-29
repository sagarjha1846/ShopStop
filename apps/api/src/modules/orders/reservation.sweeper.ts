import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { InventoryService } from './inventory.service';

/**
 * Reclaims stock from checkouts that were started but never paid for.
 *
 * Without this, a drop can be "sold out" purely by abandoned tabs: every unit sits in
 * a PENDING order that nobody will ever pay, and real buyers are turned away. The
 * sweeper expires those holds so the units go back on sale.
 *
 * Runs in-process on an interval. Every instance in the fleet runs it, so the pass is
 * fenced by a short Redis lock — one sweeper does the work per tick, and if that
 * instance dies the lock lapses and another picks it up on the next tick.
 */
@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationSweeper.name);
  private timer?: NodeJS.Timeout;

  /** How often to look for lapsed holds. */
  private static readonly INTERVAL_MS = 60_000;
  /** Lock TTL — comfortably longer than a pass, short enough to recover from a crash. */
  private static readonly LOCK_TTL_MS = 55_000;
  private static readonly LOCK_KEY = 'lock:reservation-sweeper';
  /** Bounded per pass so one tick cannot hold a long transaction over the order table. */
  private static readonly BATCH = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => this.logger.error(`Sweep failed: ${String(err)}`));
    }, ReservationSweeper.INTERVAL_MS);
    // Do not keep the process alive just for the sweeper.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Expire every PENDING order whose hold has lapsed, returning its units.
   * Returns how many were reclaimed (exposed for tests and for the metrics story).
   */
  async sweep(now = new Date()): Promise<number> {
    if (!(await this.acquireLock())) return 0;

    const expired = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        stockHeld: true,
        reservationExpiresAt: { not: null, lte: now },
      },
      select: { id: true, listingId: true, quantity: true },
      take: ReservationSweeper.BATCH,
    });
    if (expired.length === 0) return 0;

    let reclaimed = 0;
    for (const order of expired) {
      try {
        // Per-order transaction: one poisoned row cannot block the rest of the batch.
        const released = await this.prisma.$transaction(async (tx) => {
          const didRelease = await this.inventory.releaseOrderHold(tx, order);
          if (!didRelease) return false; // someone else already resolved this order
          await tx.order.update({
            where: { id: order.id, status: OrderStatus.PENDING },
            data: {
              status: OrderStatus.CANCELLED,
              trackingNote: 'Checkout expired before payment',
            },
          });
          return true;
        });
        if (released) reclaimed++;
      } catch (err) {
        // Lost a race with a real payment — the order left PENDING mid-transaction.
        // The transaction rolled back, so no stock moved. Nothing to repair.
        this.logger.debug(`Skipped expired order ${order.id}: ${String(err)}`);
      }
    }

    if (reclaimed > 0) this.logger.log(`Reclaimed ${reclaimed} expired checkout reservation(s)`);
    return reclaimed;
  }

  /** Single-flight across the fleet: only the lock holder sweeps this tick. */
  private async acquireLock(): Promise<boolean> {
    const token = await this.redis.client.set(
      ReservationSweeper.LOCK_KEY,
      String(process.pid),
      'PX',
      ReservationSweeper.LOCK_TTL_MS,
      'NX',
    );
    return token === 'OK';
  }
}
