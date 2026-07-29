import { OrderStatus } from '@prisma/client';
import { ReservationSweeper } from './reservation.sweeper';
import { InventoryService } from './inventory.service';

/**
 * The sweeper's job is to reclaim stock from abandoned checkouts without ever
 * reclaiming stock from a checkout that actually completed. These cover the races
 * an end-to-end test can't reliably provoke.
 */
describe('ReservationSweeper', () => {
  const expiredOrder = { id: 'ord_1', listingId: 'lst_1', quantity: 2 };

  function build({
    lockAcquired = true,
    expired = [expiredOrder],
    releaseResult = true as boolean | Error,
  } = {}) {
    const orderUpdate = jest.fn().mockResolvedValue({});
    const tx = { order: { update: orderUpdate } };

    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue(expired) },
      // Run the callback inline so assertions see the real control flow, and
      // propagate throws the way a rolled-back transaction would.
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const redis = {
      client: { set: jest.fn().mockResolvedValue(lockAcquired ? 'OK' : null) },
    };
    const inventory = {
      releaseOrderHold: jest.fn(async () => {
        if (releaseResult instanceof Error) throw releaseResult;
        return releaseResult;
      }),
    };

    const sweeper = new ReservationSweeper(
      prisma as never,
      redis as never,
      inventory as unknown as InventoryService,
    );
    return { sweeper, prisma, redis, inventory, orderUpdate };
  }

  it('cancels an expired hold and returns its units', async () => {
    const { sweeper, inventory, orderUpdate } = build();

    await expect(sweeper.sweep()).resolves.toBe(1);

    expect(inventory.releaseOrderHold).toHaveBeenCalledWith(expect.anything(), expiredOrder);
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        // Guarding on PENDING is what stops the sweeper cancelling an order that
        // was paid for between the SELECT and the UPDATE.
        where: { id: 'ord_1', status: OrderStatus.PENDING },
        data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
      }),
    );
  });

  it('does not sweep when another instance holds the lock', async () => {
    const { sweeper, prisma, inventory } = build({ lockAcquired: false });

    await expect(sweeper.sweep()).resolves.toBe(0);

    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(inventory.releaseOrderHold).not.toHaveBeenCalled();
  });

  it('takes the lock with NX so only one instance sweeps per tick', async () => {
    const { sweeper, redis } = build();

    await sweeper.sweep();

    expect(redis.client.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('leaves the order alone when the hold was already released', async () => {
    // Someone paid (or cancelled) first: claimHold finds stock_held already false.
    const { sweeper, orderUpdate } = build({ releaseResult: false });

    await expect(sweeper.sweep()).resolves.toBe(0);

    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('keeps going when one order in the batch fails', async () => {
    const good = { id: 'ord_2', listingId: 'lst_2', quantity: 1 };
    const { sweeper, inventory } = build({ expired: [expiredOrder, good] });
    (inventory.releaseOrderHold as jest.Mock)
      .mockRejectedValueOnce(new Error('row is locked'))
      .mockResolvedValueOnce(true);

    // The poisoned row is skipped; the healthy one is still reclaimed.
    await expect(sweeper.sweep()).resolves.toBe(1);
    expect(inventory.releaseOrderHold).toHaveBeenCalledTimes(2);
  });

  it('only looks at PENDING orders that still hold stock and have lapsed', async () => {
    const { sweeper, prisma } = build({ expired: [] });
    const now = new Date('2026-07-29T12:00:00Z');

    await sweeper.sweep(now);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: OrderStatus.PENDING,
          stockHeld: true,
          reservationExpiresAt: { not: null, lte: now },
        },
      }),
    );
  });
});
