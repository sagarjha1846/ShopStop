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
      this.logger.warn(`Capture webhook for unknown providerOrderId ${providerOrderId}`);
      return;
    }
    if (payment.status === PaymentStatus.CAPTURED) return; // idempotent replay

    // Guard against amount tampering: captured amount must match what we charged.
    if (amountMinor !== undefined && amountMinor !== payment.amountMinor) {
      this.logger.error(`Amount mismatch on ${payment.id}: charged ${payment.amountMinor}, captured ${amountMinor}`);
      throw AppError.conflict('Captured amount does not match order');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CAPTURED,
          providerPaymentId,
          method,
          idempotencyKey: providerPaymentId ?? payment.idempotencyKey,
        },
      });
      await tx.transaction.create({
        data: {
          orderId: payment.orderId,
          type: TransactionType.CHARGE,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          providerRef: providerPaymentId,
        },
      });
    });

    await this.orders.markPaid(payment.orderId);
    this.logger.log(`Payment captured for order ${payment.orderId}`);
  }

  private async onFailed(providerOrderId?: string): Promise<void> {
    if (!providerOrderId) return;
    const payment = await this.prisma.payment.findFirst({ where: { providerOrderId } });
    if (payment && payment.status !== PaymentStatus.CAPTURED) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
    }
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
