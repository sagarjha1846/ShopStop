'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney, timeAgo } from '@/lib/format';
import { Badge, Button, Card, Divider, Loading, SignInPrompt } from '@/components/ui';

interface TimelineEntry {
  status: string;
  actor: string;
  at: string;
  note?: string;
}
interface Order {
  id: string;
  status: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: string;
  buyerId: string;
  sellerId: string;
  listing?: { id: string; title: string } | null;
  payment?: { status: string } | null;
  timeline: TimelineEntry[];
}

// Which transition actions each party may attempt from a given status (mirrors the
// backend state machine; the server remains the source of truth).
function actionsFor(order: Order, meId: string): { action: string; label: string }[] {
  const isBuyer = meId === order.buyerId;
  const isSeller = meId === order.sellerId;
  const s = order.status;
  const out: { action: string; label: string }[] = [];
  if (isSeller && s === 'PENDING') out.push({ action: 'accept', label: 'Accept' }, { action: 'reject', label: 'Reject' });
  if (isBuyer && (s === 'PENDING' || s === 'ACCEPTED')) out.push({ action: 'cancel', label: 'Cancel' });
  if (isSeller && s === 'ACCEPTED') out.push({ action: 'pack', label: 'Mark packed' });
  if (isSeller && s === 'PACKED') out.push({ action: 'ship', label: 'Mark shipped' });
  if (isBuyer && s === 'SHIPPED') out.push({ action: 'deliver', label: 'Confirm delivery' });
  if (isBuyer && s === 'DELIVERED') out.push({ action: 'return', label: 'Return' });
  return out;
}

// Name states the way a person would, not the way the database does.
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting payment',
  ACCEPTED: 'Paid',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REJECTED: 'Declined',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
};

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warn' | 'danger' | 'brand'> = {
  PENDING: 'warn',
  ACCEPTED: 'brand',
  PACKED: 'brand',
  SHIPPED: 'brand',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REJECTED: 'danger',
  RETURNED: 'warn',
  REFUNDED: 'muted',
};

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [meId, setMeId] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setOrder(await apiAuthed<Order>(`/orders/${id}`));
  }

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const me = await apiAuthed<{ id: string }>('/me/profile');
          setMeId(me.id);
          await load();
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'Failed to load order');
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function transition(action: string) {
    setErr(null);
    try {
      await apiAuthed(`/orders/${id}/transition`, { method: 'POST', body: { action } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    }
  }
  async function pay() {
    setErr(null);
    try {
      // Creates the gateway intent; in dev this returns a synthetic order id.
      // A real client opens the Razorpay checkout with the returned token.
      await apiAuthed('/payments/intent', {
        method: 'POST',
        headers: { 'idempotency-key': `pay-${id}` },
        body: { orderId: id },
      });
      setErr('Payment intent created (dev: complete via gateway checkout / webhook).');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    }
  }

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next={`/orders/${id}`} what="this order" />;
  if (!order)
    return (
      <p role="alert" className="py-16 text-center text-footnote text-danger">
        {err ?? 'Order not found'}
      </p>
    );

  const actions = actionsFor(order, meId);
  const money = (n: number) => formatMoney(n, order.currency);

  return (
    <div className="mx-auto max-w-2xl py-4">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-headline font-semibold">
              <Link href={`/l/${order.listing?.id}`} className="hover:underline">
                {order.listing?.title ?? 'Order'}
              </Link>
            </h1>
            <p className="tabular mt-1 text-title font-semibold">{money(order.totalMinor)}</p>
          </div>
          <Badge tone={STATUS_TONE[order.status] ?? 'muted'}>
            {STATUS_LABEL[order.status] ?? order.status}
          </Badge>
        </div>

        <Divider className="my-5" />

        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-muted">Subtotal</dt>
            <dd className="tabular text-caption">{money(order.subtotalMinor)}</dd>
          </div>
          {!!order.discountMinor && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-caption text-muted">Discount</dt>
              <dd className="tabular text-caption text-success">-{money(order.discountMinor)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-muted">Total</dt>
            <dd className="tabular text-caption font-semibold">{money(order.totalMinor)}</dd>
          </div>
        </dl>

        {(order.status === 'PENDING' && meId === order.buyerId) || actions.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {order.status === 'PENDING' && meId === order.buyerId && (
              <Button onClick={pay}>Pay now</Button>
            )}
            {actions.map((a) => (
              <Button key={a.action} variant="secondary" onClick={() => transition(a.action)}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}

        {err && (
          <p role="status" className="mt-4 text-caption text-warn">
            {err}
          </p>
        )}
      </Card>

      <section className="mt-8">
        <h2 className="mb-4 text-headline font-semibold">Timeline</h2>
        <ol className="space-y-4 border-l border-hairline pl-5">
          {order.timeline?.map((t, i) => (
            <li key={i} className="relative">
              <span
                aria-hidden
                className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-pill bg-accent ring-4 ring-[var(--canvas)]"
              />
              <p className="text-footnote font-medium">{STATUS_LABEL[t.status] ?? t.status}</p>
              <p className="mt-0.5 text-caption text-faint">
                {t.actor} · {timeAgo(t.at)}
                {t.note ? ` · ${t.note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
