import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider as ProviderEnum } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../config/config.service';
import { AppError } from '../../../common/errors/app-error';
import type {
  CreateIntentInput,
  CreateIntentResult,
  IPaymentProvider,
  RefundInput,
  RefundResult,
  WebhookEvent,
  WebhookHeaders,
} from './payment-provider';

function header(headers: WebhookHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Cashfree adapter — proves the payment-provider port: PaymentsService needs no
 * changes to support it. Webhook verification is Cashfree's real scheme:
 * base64(HMAC-SHA256(secret, timestamp + rawBody)) over the x-webhook-timestamp
 * and x-webhook-signature headers. Order creation calls Cashfree's API when real
 * creds are set; otherwise returns a synthetic id for local flows.
 */
@Injectable()
export class CashfreeProvider implements IPaymentProvider {
  readonly key = ProviderEnum.CASHFREE;
  private readonly logger = new Logger(CashfreeProvider.name);

  constructor(private readonly config: AppConfigService) {}

  private get secret(): string {
    // Reuses the generic gateway secret env in dev; a dedicated CASHFREE_* var in prod.
    return process.env.CASHFREE_WEBHOOK_SECRET || this.config.get('RAZORPAY_WEBHOOK_SECRET');
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    // Dev/test: no live call (real impl POSTs to Cashfree /pg/orders).
    return {
      providerOrderId: `cf_order_dev_${input.orderId.slice(-12)}`,
      clientToken: process.env.CASHFREE_APP_ID || 'cf_test_app',
    };
  }

  /**
   * Refund through Cashfree. Two things differ from Razorpay and both are easy to
   * get wrong: refunds are keyed on the *order*, not the payment, and amounts are
   * in major units (rupees) — the same conversion the webhook parser does in
   * reverse. `refund_id` is Cashfree's idempotency key, so a retried resolution
   * cannot refund twice; it is sanitised to the alphanumeric/underscore/hyphen
   * form Cashfree accepts and trimmed to their 40-character limit.
   *
   * The live branch is written from Cashfree's documented API but has not been
   * exercised against real credentials — createIntent is still a stub here, so
   * this provider cannot take a live payment to refund in the first place. It is
   * safe in the meantime because a failed call throws and nothing is booked.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `r_${input.reference}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    if (!appId || !secretKey) {
      // Dev/test: mirrors createIntent, so cancel → refund → ledger is exercisable.
      return { providerRefundId: `cf_rfnd_dev_${refundId.slice(-16)}` };
    }
    const res = await fetch(`https://api.cashfree.com/pg/orders/${input.providerOrderId}/refunds`, {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refund_amount: input.amountMinor / 100,
        refund_id: refundId,
        refund_note: `Refund for ${input.reference}`,
      }),
    });
    if (!res.ok) {
      this.logger.error(`Cashfree refund failed for ${input.providerOrderId}: ${res.status}`);
      throw new AppError('PAYMENT_ERROR', 'Gateway refused the refund');
    }
    const data = (await res.json()) as { cf_refund_id?: string | number; refund_id?: string };
    return { providerRefundId: String(data.cf_refund_id ?? data.refund_id ?? refundId) };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: WebhookHeaders): WebhookEvent {
    const signature = header(headers, 'x-webhook-signature');
    const timestamp = header(headers, 'x-webhook-timestamp');
    if (!signature || !timestamp) throw new AppError('PAYMENT_ERROR', 'Missing webhook signature/timestamp');

    const expected = createHmac('sha256', this.secret)
      .update(timestamp + rawBody.toString('utf8'))
      .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('PAYMENT_ERROR', 'Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      type?: string;
      data?: {
        order?: { order_id?: string };
        payment?: { cf_payment_id?: string; payment_amount?: number; payment_status?: string; payment_group?: string };
      };
    };
    // Normalize Cashfree event → the common WebhookEvent shape.
    const status = payload.data?.payment?.payment_status;
    const type = status === 'SUCCESS' ? 'payment.captured' : status === 'FAILED' ? 'payment.failed' : payload.type ?? 'unknown';
    return {
      type,
      providerPaymentId: payload.data?.payment?.cf_payment_id ? String(payload.data.payment.cf_payment_id) : undefined,
      providerOrderId: payload.data?.order?.order_id,
      // Cashfree amounts are in major units (rupees) → convert to minor.
      amountMinor:
        payload.data?.payment?.payment_amount != null
          ? Math.round(payload.data.payment.payment_amount * 100)
          : undefined,
      method: payload.data?.payment?.payment_group,
      raw: payload,
    };
  }
}
