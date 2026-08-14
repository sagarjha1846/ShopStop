import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider as ProviderEnum } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../config/config.service';
import { AppError } from '../../../common/errors/app-error';
import type {
  ClientCallback,
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
 * Razorpay adapter. Webhook signature verification is the real HMAC-SHA256 scheme
 * Razorpay uses (constant-time compared). Order creation calls Razorpay's Orders API
 * when real credentials are configured; in dev/test (placeholder keys) it returns a
 * synthetic order id so the full pay→webhook→fulfil flow is exercisable locally.
 */
@Injectable()
export class RazorpayProvider implements IPaymentProvider {
  readonly key = ProviderEnum.RAZORPAY;
  private readonly logger = new Logger(RazorpayProvider.name);

  constructor(private readonly config: AppConfigService) {}

  private get configured(): boolean {
    const id = this.config.get('RAZORPAY_KEY_ID');
    const secret = this.config.get('RAZORPAY_KEY_SECRET');
    // Empty is not configured. docker-compose.deploy.yml passes these through
    // unconditionally, so an operator who sets no payment keys sends '' rather
    // than nothing — and a bare placeholder check reads '' as real credentials
    // and starts calling the live Razorpay API with empty auth.
    if (!id || !secret) return false;
    return !id.includes('xxxxxxxx') && !secret.includes('xxxxxxxx');
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!this.configured) {
      // Dev/test: no live call. Deterministic-ish synthetic id.
      return {
        providerOrderId: `order_dev_${input.orderId.slice(-12)}`,
        clientToken: this.config.get('RAZORPAY_KEY_ID'),
      };
    }
    const auth = Buffer.from(
      `${this.config.get('RAZORPAY_KEY_ID')}:${this.config.get('RAZORPAY_KEY_SECRET')}`,
    ).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: { orderId: input.orderId },
      }),
    });
    if (!res.ok) {
      this.logger.error(`Razorpay order create failed: ${res.status}`);
      throw new AppError('PAYMENT_ERROR', 'Failed to create payment order');
    }
    const data = (await res.json()) as { id: string };
    return { providerOrderId: data.id, clientToken: this.config.get('RAZORPAY_KEY_ID') };
  }

  /**
   * Razorpay signs the browser callback as HMAC(order_id|payment_id) with the API
   * key secret — a different key and a different payload shape from the webhook
   * signature, so the two verifications cannot share an implementation.
   */
  verifyClientCallback(cb: ClientCallback): boolean {
    const secret = this.config.get('RAZORPAY_KEY_SECRET');
    const expected = createHmac('sha256', secret)
      .update(`${cb.providerOrderId}|${cb.providerPaymentId}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(cb.signature ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Refund a captured payment. Razorpay takes the amount in minor units and
   * accepts a partial figure, so the same call serves both refund kinds.
   *
   * Mirrors createIntent's dev behaviour: with placeholder keys it returns a
   * synthetic refund id rather than calling out, so the dispute → refund → ledger
   * path is exercisable locally. It never returns success for a live call that
   * failed — the caller relies on a throw to avoid booking a refund that did not
   * happen.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    if (!this.configured) {
      return { providerRefundId: `rfnd_dev_${input.reference.slice(-16)}` };
    }
    const auth = Buffer.from(
      `${this.config.get('RAZORPAY_KEY_ID')}:${this.config.get('RAZORPAY_KEY_SECRET')}`,
    ).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${input.providerPaymentId}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        // Razorpay dedupes retries on this header, so a retried resolution cannot
        // refund the buyer twice at the gateway.
        'X-Payment-Idempotency': input.reference,
      },
      body: JSON.stringify({ amount: input.amountMinor, notes: { reference: input.reference } }),
    });
    if (!res.ok) {
      this.logger.error(`Razorpay refund failed for ${input.providerPaymentId}: ${res.status}`);
      throw new AppError('PAYMENT_ERROR', 'Gateway refused the refund');
    }
    const data = (await res.json()) as { id: string };
    return { providerRefundId: data.id };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: WebhookHeaders): WebhookEvent {
    const signature = header(headers, 'x-razorpay-signature');
    if (!signature) throw new AppError('PAYMENT_ERROR', 'Missing webhook signature');
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET');
    const expected = createHmac('sha256', secret).update(rawBody.toString('utf8')).digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('PAYMENT_ERROR', 'Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; method?: string } } };
    };
    const entity = payload.payload?.payment?.entity;
    return {
      type: payload.event,
      providerPaymentId: entity?.id,
      providerOrderId: entity?.order_id,
      amountMinor: entity?.amount,
      method: entity?.method,
      raw: payload,
    };
  }
}
