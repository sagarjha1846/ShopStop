import { Injectable, Logger } from '@nestjs/common';
import {
  OrderStatus,
  PaymentProvider as ProviderEnum,
  PaymentStatus,
  TransactionType,
  type Payment,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { OrdersService } from '../orders/orders.service';
import { RazorpayProvider } from './provider/razorpay.provider';
import { CashfreeProvider } from './provider/cashfree.provider';
import { BoostsService } from './boosts.service';
import { SubscriptionsService } from './subscriptions.service';
import type { IPaymentProvider, WebhookHeaders } from './provider/payment-provider';

export interface PaymentIntent {
  provider: ProviderEnum;
  providerOrderId: string;
  amountMinor: number;
  currency: string;
  clientToken: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers: Map<ProviderEnum, IPaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly boosts: BoostsService,
    private readonly subscriptions: SubscriptionsService,
    razorpay: RazorpayProvider,
    cashfree: CashfreeProvider,
  ) {
    this.providers = new Map<ProviderEnum, IPaymentProvider>([
      [razorpay.key, razorpay],
      [cashfree.key, cashfree],
    ]);
  }

  async createIntent(
    orderId: string,
    userId: string,
    providerKey: ProviderEnum = ProviderEnum.RAZORPAY,
  ): Promise<PaymentIntent> {
    const provider = this.providerOrThrow(providerKey);
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order) throw AppError.notFound('Order');
    if (order.buyerId !== userId) throw AppError.forbidden('Only the buyer can pay for this order');
    if (order.status !== OrderStatus.PENDING) throw AppError.illegalState('Order is not awaiting payment');
    if (order.payment?.status === PaymentStatus.CAPTURED) throw AppError.conflict('Order is already paid');

    const intent = await provider.createIntent({
      amountMinor: order.totalMinor,
      currency: order.currency,
      orderId: order.id,
      receipt: `ord_${order.id.slice(-16)}`,
    });

    await this.prisma.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        provider: providerKey,
        status: PaymentStatus.CREATED,
        amountMinor: order.totalMinor,
        currency: order.currency,
        providerOrderId: intent.providerOrderId,
      },
      update: { providerOrderId: intent.providerOrderId, provider: providerKey, status: PaymentStatus.CREATED },
    });

    return {
      provider: providerKey,
      providerOrderId: intent.providerOrderId,
      amountMinor: order.totalMinor,
      currency: order.currency,
      clientToken: intent.clientToken,
    };
  }

  /**
   * Buy sponsored placement for a listing. Returns the gateway intent; the boost
   * window opens only when the capture webhook arrives.
   */
  async purchaseBoost(
    sellerId: string,
    listingId: string,
    days: number,
    providerKey: ProviderEnum = ProviderEnum.RAZORPAY,
  ) {
    return this.boosts.purchase(sellerId, listingId, days, this.providerOrThrow(providerKey));
  }

  /** Buy a Pro seller plan. Activates on capture, like every other purchase here. */
  async purchaseSubscription(userId: string, providerKey: ProviderEnum = ProviderEnum.RAZORPAY) {
    return this.subscriptions.subscribe(userId, this.providerOrThrow(providerKey));
  }

  /**
   * Confirm a payment from the buyer's own browser callback.
   *
   * The signature proves the gateway produced this payload, so it is safe to
   * advance the order immediately rather than making the buyer watch a spinner
   * until the webhook arrives. It is *not* a second source of truth: it routes
   * into exactly the same idempotent capture as the webhook, so whichever lands
   * first books the money and the other is a no-op.
   */
  async confirmFromClient(
    userId: string,
    providerKey: ProviderEnum,
    cb: { providerOrderId: string; providerPaymentId: string; signature: string },
  ): Promise<{ status: PaymentStatus; orderId: string }> {
    const provider = this.providerOrThrow(providerKey);
    if (!provider.verifyClientCallback) {
      throw AppError.validation(`${providerKey} does not support client confirmation`);
    }
    if (!provider.verifyClientCallback(cb)) {
      this.logger.warn(`Rejected client callback with a bad signature for ${cb.providerOrderId}`);
      // Deliberately not PAYMENT_ERROR (502): nothing upstream is broken. The
      // caller sent a payload that doesn't verify, and 502 would invite a retry.
      throw AppError.validation('Invalid payment signature');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { providerOrderId: cb.providerOrderId },
      include: { order: { select: { id: true, buyerId: true } } },
    });
    if (!payment) throw AppError.notFound('Payment');
    // Only the buyer who owns the order may confirm it. A valid signature proves
    // the gateway made the payload, not who is replaying it at us.
    if (payment.order.buyerId !== userId) throw AppError.forbidden();

    await this.onCaptured(cb.providerOrderId, cb.providerPaymentId, payment.amountMinor, undefined);

    const fresh = await this.prisma.payment.findUnique({ where: { id: payment.id } });
    return { status: fresh?.status ?? payment.status, orderId: payment.orderId };
  }

  /**
   * Gateway webhook entry point. Verifies signature, is idempotent (a captured
   * payment reprocessed is a no-op), records a ledger Transaction, and advances the
   * order to ACCEPTED. Heavy follow-on work (receipts, payouts) is enqueued in Phase 4+.
   */
  async handleWebhook(providerKey: string, rawBody: Buffer, headers: WebhookHeaders): Promise<{ received: true }> {
    const provider = this.providerOrThrow(this.parseProvider(providerKey));
    const event = provider.verifyAndParseWebhook(rawBody, headers);

    if (event.type === 'payment.captured') {
      await this.onCaptured(event.providerOrderId, event.providerPaymentId, event.amountMinor, event.method);
    } else if (event.type === 'payment.failed') {
      await this.onFailed(event.providerOrderId);
    } else {
      this.logger.debug(`Ignoring webhook event ${event.type}`);
    }
    return { received: true };
  }

  // ---- internals ----

  private async onCaptured(
    providerOrderId?: string,
    providerPaymentId?: string,
    amountMinor?: number,
    method?: string,
  ): Promise<void> {
    if (!providerOrderId) throw AppError.validation('Webhook missing provider order id');
    const payment = await this.prisma.payment.findFirst({ where: { providerOrderId } });
    if (!payment) {
      // Not an order payment — it may be a boost purchase, which carries its own
      // provider ids so the order money path stays untouched.
      if (await this.boosts.activateFromWebhook(providerOrderId, providerPaymentId, amountMinor)) return;
      if (await this.subscriptions.activateFromWebhook(providerOrderId, providerPaymentId, amountMinor)) return;
      this.logger.warn(`Capture webhook for unknown providerOrderId ${providerOrderId}`);
      return;
    }
    if (payment.status === PaymentStatus.CAPTURED) return; // fast path for replays

    // Guard against amount tampering: captured amount must match what we charged.
    if (amountMinor !== undefined && amountMinor !== payment.amountMinor) {
      this.logger.error(`Amount mismatch on ${payment.id}: charged ${payment.amountMinor}, captured ${amountMinor}`);
      throw AppError.conflict('Captured amount does not match order');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { sellerId: true, feeMinor: true },
    });

    const booked = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set inside the transaction. The status check above is only a
      // fast path: gateways retry webhooks concurrently, and two deliveries that
      // both read AUTHORIZED would otherwise each write a ledger row and book the
      // revenue twice. Exactly one caller can move the row out of AUTHORIZED.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentStatus.CAPTURED } },
        data: {
          status: PaymentStatus.CAPTURED,
          providerPaymentId,
          method,
          idempotencyKey: providerPaymentId ?? payment.idempotencyKey,
        },
      });
      if (claimed.count === 0) return false;

      // Gross inflow from the buyer.
      await tx.transaction.create({
        data: {
          orderId: payment.orderId,
          type: TransactionType.CHARGE,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          providerRef: providerPaymentId,
        },
      });

      // The platform's commission, booked against the seller's proceeds. Without
      // this row the fee exists only as a number on the order and never lands in
      // the ledger, so platform revenue can't be reconciled or reported.
      if (order && order.feeMinor > 0) {
        await tx.transaction.create({
          data: {
            orderId: payment.orderId,
            userId: order.sellerId,
            type: TransactionType.FEE,
            amountMinor: order.feeMinor,
            currency: payment.currency,
            providerRef: providerPaymentId,
            meta: { basis: 'order.commission' },
          },
        });
      }
      return true;
    });

    if (!booked) return; // a concurrent delivery won the race and already booked it

    await this.orders.markPaid(payment.orderId);
    this.logger.log(`Payment captured for order ${payment.orderId} (fee ${order?.feeMinor ?? 0})`);
  }

  private async onFailed(providerOrderId?: string): Promise<void> {
    if (!providerOrderId) return;
    const payment = await this.prisma.payment.findFirst({ where: { providerOrderId } });
    if (payment) {
      if (payment.status !== PaymentStatus.CAPTURED) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      }
      return;
    }
    if (await this.boosts.failFromWebhook(providerOrderId)) return;
    await this.subscriptions.failFromWebhook(providerOrderId);
  }

  private providerOrThrow(key: ProviderEnum): IPaymentProvider {
    const p = this.providers.get(key);
    if (!p) throw AppError.validation(`Unsupported payment provider: ${key}`);
    return p;
  }

  private parseProvider(key: string): ProviderEnum {
    const upper = key.toUpperCase();
    if ((Object.values(ProviderEnum) as string[]).includes(upper)) return upper as ProviderEnum;
    throw AppError.validation(`Unknown provider "${key}"`);
  }

  /** Test/introspection helper. */
  async getByOrder(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { orderId } });
  }
}
