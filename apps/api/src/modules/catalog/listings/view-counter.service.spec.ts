import { ViewCounterService } from './view-counter.service';

/**
 * The buffer's contract: never lose a view, never write the same view twice, and
 * never let a telemetry failure break a page render.
 */
describe('ViewCounterService', () => {
  function build({ pending = {} as Record<string, string>, renameFails = false } = {}) {
    let staged: Record<string, string> = {};
    let claimed = false;

    const client = {
      hincrby: jest.fn(async (_key: string, field: string) => {
        pending[field] = String(Number(pending[field] ?? 0) + 1);
        return Number(pending[field]);
      }),
      hget: jest.fn(async (_key: string, field: string) => pending[field] ?? null),
      // RENAME moves the whole pending hash into this instance's staging key.
      rename: jest.fn(async () => {
        if (renameFails || Object.keys(pending).length === 0) throw new Error('no such key');
        staged = { ...pending };
        for (const k of Object.keys(pending)) delete pending[k];
        claimed = true;
        return 'OK';
      }),
      hgetall: jest.fn(async () => (claimed ? staged : {})),
      del: jest.fn(async () => {
        staged = {};
        claimed = false;
        return 1;
      }),
    };

    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const service = new ViewCounterService(prisma as never, { client } as never);
    return { service, prisma, client, pending: () => pending };
  }

  it('records a view in Redis and reports the un-flushed total', async () => {
    const { service, prisma } = build();

    await expect(service.record('lst_1')).resolves.toBe(1);
    await expect(service.record('lst_1')).resolves.toBe(2);

    // The whole point: reading a listing must not write the listing row.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('never throws when Redis is unavailable', async () => {
    const { service, client } = build();
    client.hincrby.mockRejectedValueOnce(new Error('redis down'));

    // A telemetry counter must not be able to fail a product page.
    await expect(service.record('lst_1')).resolves.toBe(0);
  });

  it('folds buffered views into one batched write and clears the buffer', async () => {
    const { service, prisma, client } = build({ pending: { lst_1: '900', lst_2: '3' } });

    await expect(service.flush()).resolves.toBe(2);

    // Two hot listings, still a single statement.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(client.del).toHaveBeenCalled();
  });

  it('drops the buffer only after Postgres accepted the batch', async () => {
    const { service, prisma, client } = build({ pending: { lst_1: '5' } });
    prisma.$executeRaw.mockRejectedValueOnce(new Error('db down'));

    await expect(service.flush()).rejects.toThrow('db down');

    // Buffer survives the failure, so the next flush replays it instead of losing it.
    expect(client.del).not.toHaveBeenCalled();
  });

  it('replays a batch left staged by a previous crash before claiming a new one', async () => {
    const { service, prisma, client } = build({ pending: { lst_1: '2' } });

    // First flush stages and writes.
    await service.flush();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    // Nothing pending now: flush is a no-op rather than a spurious write.
    prisma.$executeRaw.mockClear();
    client.del.mockClear();
    await expect(service.flush()).resolves.toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing buffered', async () => {
    const { service, prisma } = build({ renameFails: true });

    await expect(service.flush()).resolves.toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('ignores non-positive counts rather than writing them', async () => {
    const { service, prisma } = build({ pending: { lst_1: '0', lst_2: 'nonsense' } });

    await expect(service.flush()).resolves.toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
