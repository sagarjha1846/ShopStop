import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Prisma transaction client — these statements must run inside the caller's transaction. */
type Tx = Prisma.TransactionClient;

/**
 * Stock accounting for listings.
 *
 * The whole point of this service is that inventory moves via **single atomic
 * statements**, never read-then-write. During a drop, hundreds of checkouts race for
 * the same row; a `SELECT quantity` followed by an `UPDATE` lets every one of them
 * observe the same pre-decrement value and oversell. Postgres serialises the
 * conditional `UPDATE ... WHERE quantity >= n` per row instead, so exactly as many
 * requests succeed as there are units, and the rest are cleanly turned away.
 *
 * Stock is held from **checkout**, not from payment: a buyer who reaches the payment
 * screen owns their unit for RESERVATION_TTL, and abandoned checkouts are swept back
 * into the pool (see ReservationSweeper).
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /** How long an unpaid checkout may hold stock before the sweeper reclaims it. */
  static readonly RESERVATION_TTL_MS = 15 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve `quantity` units, atomically. Returns false when the listing cannot
   * satisfy the request — the caller turns that into a 409, and no stock moved.
   *
   * The status flip to SOLD happens in the same statement so a depleted listing can
   * never be observed as ACTIVE-with-zero-stock.
   */
  async reserve(tx: Tx, listingId: string, quantity: number): Promise<boolean> {
    const rows = await tx.$executeRaw`
      UPDATE "listings"
         SET "quantity" = "quantity" - ${quantity},
             "status" = CASE WHEN "quantity" - ${quantity} <= 0
                             THEN 'SOLD'::"ListingStatus" ELSE "status" END,
             "updated_at" = now()
       WHERE "id" = ${listingId}
         AND "deleted_at" IS NULL
         AND "status" = 'ACTIVE'
         AND "quantity" >= ${quantity}
    `;
    return rows === 1;
  }

  /**
   * Return `quantity` units to a listing. Relists it only if it went SOLD through
   * depletion — a seller-paused or moderator-removed listing must stay off the market.
   */
  async release(tx: Tx, listingId: string, quantity: number): Promise<void> {
    await tx.$executeRaw`
      UPDATE "listings"
         SET "quantity" = "quantity" + ${quantity},
             "status" = CASE WHEN "status" = 'SOLD'
                             THEN 'ACTIVE'::"ListingStatus" ELSE "status" END,
             "updated_at" = now()
       WHERE "id" = ${listingId}
         AND "deleted_at" IS NULL
    `;
  }

  /**
   * Claim an order's stock hold, exactly once. Returns true only for the caller that
   * actually flipped `stock_held` true -> false; concurrent or repeated releases get
   * false and must not touch listing stock. This is what stops a double-cancel or a
   * retried webhook from minting phantom inventory.
   */
  async claimHold(tx: Tx, orderId: string): Promise<boolean> {
    const rows = await tx.$executeRaw`
      UPDATE "orders"
         SET "stock_held" = false, "reservation_expires_at" = NULL
       WHERE "id" = ${orderId} AND "stock_held" = true
    `;
    return rows === 1;
  }

  /**
   * Release an order's hold back to its listing, if it still holds one.
   * Safe to call repeatedly — only the first call moves stock.
   */
  async releaseOrderHold(
    tx: Tx,
    order: { id: string; listingId: string; quantity: number },
  ): Promise<boolean> {
    const claimed = await this.claimHold(tx, order.id);
    if (!claimed) return false;
    await this.release(tx, order.listingId, order.quantity);
    return true;
  }

  /**
   * Convert a temporary checkout hold into a permanent one: the buyer paid, so the
   * units are gone for good and the reservation must stop expiring.
   */
  async confirmHold(tx: Tx, orderId: string): Promise<void> {
    await tx.order.update({
      where: { id: orderId },
      data: { reservationExpiresAt: null },
    });
  }

  /** Wall-clock deadline for a fresh checkout hold. */
  static reservationDeadline(now = new Date()): Date {
    return new Date(now.getTime() + InventoryService.RESERVATION_TTL_MS);
  }
}
