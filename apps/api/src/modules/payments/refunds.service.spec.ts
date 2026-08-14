import { PaymentProvider as ProviderEnum, PaymentStatus } from '@prisma/client';
import { RefundsService } from './refunds.service';

/**
 * The refund path's ordering guarantee, in isolation.
 *
 * The bug this exists to prevent: a REFUND row describing money that never left
 * the building. The gateway call has to come first, and nothing may be written
 * when it fails. That is hard to force through the black-box E2E — both real
 * adapters succeed in dev — so it is pinned here with a gateway that refuses.
 */
interface Fake {
  captured?: boolean;
  totalMinor?: number;
  feeMinor?: number;
  priorRefunds?: number;
}

function build(
  fake: Fake,
  refundImpl: (() => Promise<{ providerRefundId: string }>) | null,
) {
  const written: Array<Record<string, unknown>> = [];
  let refundCalls = 0;

  const prisma = {
    order: {
      findUnique: async () => ({
        totalMinor: fake.totalMinor ?? 100000,
        feeMinor: fake.feeMinor ?? 2000,
        currency: 'INR',
        sellerId: 'seller1',
        payment: {
          status: fake.captured === false ? PaymentStatus.CREATED : PaymentStatus.CAPTURED,
          provider: ProviderEnum.RAZORPAY,
          providerPaymentId: 'pay_1',
          providerOrderId: 'order_1',
        },
      }),
    },
    transaction: {
      aggregate: async () => ({ _sum: { amountMinor: fake.priorRefunds ?? 0 } }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ transaction: { create: async ({ data }: { data: Record<string, unknown> }) => written.push(data) } }),
  };

  // refundImpl null = an adapter that has not implemented refund() at all.
  const razorpay = refundImpl
    ? {
        key: ProviderEnum.RAZORPAY,
        refund: async () => {
          refundCalls += 1;
          return refundImpl();
        },
      }
    : { key: ProviderEnum.RAZORPAY };
  const cashfree = { key: ProviderEnum.CASHFREE };

  const service = new RefundsService(
    prisma as never,
    razorpay as never,
    cashfree as never,
  );
  return { service, written, calls: () => refundCalls };
}

const ok = async () => ({ providerRefundId: 'rfnd_1' });
const boom = async (): Promise<{ providerRefundId: string }> => {
  throw new Error('Gateway refused the refund');
};

describe('RefundsService', () => {
  it('books nothing when the gateway refuses', async () => {
    const { service, written } = build({}, boom);
    await expect(service.refundOrder('o1', undefined, 'ref1')).rejects.toThrow(/refused/i);
    expect(written).toHaveLength(0);
  });

  it('writes the refund and the proportional commission reversal on success', async () => {
    const { service, written } = build({ totalMinor: 100000, feeMinor: 2000 }, ok);
    const out = await service.refundOrder('o1', 30000, 'ref1');
    expect(out).toEqual({ providerRefundId: 'rfnd_1', refundedMinor: 30000, feeReversedMinor: 600 });
    // 30% of the charge back means 30% of the commission back — the platform and
    // the seller share the cost rather than the seller carrying it alone.
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ type: 'REFUND', amountMinor: 30000, providerRef: 'rfnd_1' });
    expect(written[1]).toMatchObject({ type: 'FEE', amountMinor: -600 });
  });

  it('does not call the gateway for a payment that never captured', async () => {
    const { service, written, calls } = build({ captured: false }, ok);
    expect(await service.refundOrder('o1', undefined, 'ref1')).toBeNull();
    expect(calls()).toBe(0);
    expect(written).toHaveLength(0);
  });

  it('treats an already fully refunded order as a no-op', async () => {
    const { service, calls } = build({ totalMinor: 100000, priorRefunds: 100000 }, ok);
    expect(await service.refundOrder('o1', undefined, 'ref1')).toBeNull();
    expect(calls()).toBe(0);
  });

  it('refuses to refund more than was charged', async () => {
    const { service, calls } = build({ totalMinor: 100000, priorRefunds: 80000 }, ok);
    await expect(service.refundOrder('o1', 30000, 'ref1')).rejects.toThrow(/20000 remains/);
    expect(calls()).toBe(0);
  });

  it('refuses a provider that cannot refund rather than doing nothing quietly', async () => {
    const { service, written } = build({}, null);
    await expect(service.refundOrder('o1', undefined, 'ref1')).rejects.toThrow(/cannot process refunds/);
    expect(written).toHaveLength(0);
  });
});
