import type { PaymentProvider as ProviderEnum } from '@prisma/client';

export interface CreateIntentInput {
  amountMinor: number;
  currency: string;
  orderId: string;
  receipt: string;
}

export interface CreateIntentResult {
  providerOrderId: string;
  clientToken: string; // key/handle the client SDK needs to open checkout
}

export interface WebhookEvent {
  type: string; // e.g. payment.captured, payment.failed
  providerPaymentId?: string;
  providerOrderId?: string;
  amountMinor?: number;
  method?: string;
  raw: unknown;
}

/**
 * Payment gateway port. Razorpay implements it for MVP; Cashfree/PhonePe drop in
 * behind the same interface (docs/07). Money invariants live in the ledger, not the
 * provider. Adapters must verify webhook signatures and be safe to call repeatedly.
 */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface ClientCallback {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface RefundInput {
  providerPaymentId: string;
  amountMinor: number;
  /** Our own reference, so a gateway refund can be traced back to an order. */
  reference: string;
}

export interface RefundResult {
  providerRefundId: string;
}

export interface IPaymentProvider {
  readonly key: ProviderEnum;
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /**
   * Verify the payload a gateway hands the *browser* on success. Optional: not
   * every provider has a client callback. Returns true only for a valid
   * signature; it never asserts the money moved — the webhook remains the source
   * of truth, and this only lets the buyer's own session confirm immediately
   * instead of watching a spinner until the webhook lands.
   */
  verifyClientCallback?(cb: ClientCallback): boolean;
  /**
   * Returns the parsed event iff the signature is valid; throws otherwise.
   * Providers read whatever signature/timestamp headers they need (Razorpay uses
   * one HMAC header, Cashfree signs timestamp+body across two headers).
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: WebhookHeaders): WebhookEvent;
  /**
   * Send money back to the buyer. Optional on the port, but a provider that
   * cannot refund must not silently do nothing — callers are expected to fail the
   * refund rather than book a ledger row for money that never moved.
   *
   * Throws if the gateway rejects. It must be called *before* the refund is
   * written to the ledger: a REFUND row for a transfer that never happened is
   * worse than a failed resolution an admin can retry.
   */
  refund?(input: RefundInput): Promise<RefundResult>;
}
