import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider as ProviderEnum, PaymentStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { RazorpayProvider } from './provider/razorpay.provider';
import { CashfreeProvider } from './provider/cashfree.provider';
import type { IPaymentProvider } from './provider/payment-provider';

export interface RefundOutcome {
  providerRefundId: string;
  refundedMinor: number;
  feeReversedMinor: number;
}

/**
 * The one place money goes back to a buyer.
 *
 * There were three ways to end a sale — resolve a dispute, cancel a paid order,
 * or use the order state machine's `refund` action — and only the first booked
 * anything at all, while none of them reached a gateway. Orders sat in REFUNDED
 * with the buyer's money still in the platform's account. Anything that ends a
 * paid sale now comes through here.
 *
 * Deliberately owns no order status. Callers set that themselves, because the
 * right status differs: a buyer cancelling a paid order leaves it CANCELLED, a
 * dispute refund leaves it REFUNDED, and a partial refund leaves it exactly where
 * it was. Conflating the money with the state is what let "REFUNDED" mean nothing.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private readonly providers: Map<ProviderEnum, IPaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    razorpay: RazorpayProvider,
    cashfree: CashfreeProvider,
  ) {
    this.providers = new Map<ProviderEnum, IPaymentProvider>([
      [razorpay.key, razorpay],
      [cashfree.key, cashfree],
    ]);
  }

  /**
   * Send money back and record it. `amountMinor` omitted means the full charge.
   *
   * Returns null when there is nothing to refund — no payment, or one that never
   * captured — so a caller cancelling an unpaid order can carry on. Throws when a
   * refund is owed but cannot be made, because the alternative is an order that
   * claims to be refunded while the buyer is still out of pocket.
   */
  async refundOrder(orderId: string, amountMinor: number | undefined, reference: string): Promise<RefundOutcome | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { totalMinor: true, feeMinor: true, currency: true, sellerId: true, payment: true },
    });
    if (!order) throw AppError.notFound('Order');

    const payment = order.payment;
    if (!payment || payment.status !== PaymentStatus.CAPTURED) return null;
    if (!payment.providerPaymentId) {
      throw AppError.illegalState('Payment has no gateway payment id to refund against');
    }

    const refundMinor = amountMinor ?? order.totalMinor;
    if (refundMinor <= 0 || refundMinor > order.totalMinor) {
      throw AppError.validation('Refund amount is outside what was charged');
    }

    // Never refund more than was taken, however many paths lead here. Also the
    // idempotency guard: a repeated full refund finds the charge already covered.
    const priorRefunds = await this.prisma.transaction.aggregate({
      where: { orderId, type: TransactionType.REFUND },
      _sum: { amountMinor: true },
    });
    const already = priorRefunds._sum.amountMinor ?? 0;
    if (already >= order.totalMinor) return null;
    if (already + refundMinor > order.totalMinor) {
      throw AppError.conflict(
        `Only ${order.totalMinor - already} remains refundable on this order`,
      );
    }

    const provider = this.providers.get(payment.provider);
    if (!provider?.refund) {
      // Refusing loudly beats booking a refund the buyer will never receive.
      throw AppError.illegalState(`${payment.provider} cannot process refunds`);
    }

    // Gateway first, ledger second, and never the other way round. Booking first
    // would leave the books asserting money reached the buyer precisely when the
    // call then failed. `reference` keys the gateway's own idempotency, so a
    // retried caller cannot refund twice.
    const { providerRefundId } = await provider.refund({
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId ?? '',
      amountMinor: refundMinor,
      reference,
    });

    // The commission goes back in the same proportion, so the platform and the
    // seller share the cost rather than the seller carrying all of it.
    const feeReversedMinor = Math.round((order.feeMinor * refundMinor) / order.totalMinor);

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          orderId,
          type: TransactionType.REFUND,
          amountMinor: refundMinor,
          currency: order.currency,
          providerRef: providerRefundId,
          meta: { basis: refundMinor === order.totalMinor ? 'order.refund' : 'order.refund.partial' },
        },
      });
      if (feeReversedMinor > 0) {
        await tx.transaction.create({
          data: {
            orderId,
            userId: order.sellerId,
            type: TransactionType.FEE,
            amountMinor: -feeReversedMinor,
            currency: order.currency,
            providerRef: providerRefundId,
            meta: { basis: 'order.commission.reversal' },
          },
        });
      }
    });

    this.logger.log(`Refunded ${refundMinor} on order ${orderId} (${providerRefundId})`);
    return { providerRefundId, refundedMinor: refundMinor, feeReversedMinor };
  }
}
