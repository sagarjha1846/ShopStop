'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney, timeAgo } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

interface TimelineEntry {
  status: string;
  actor: string;
  at: string;
  note?: string;
}
interface Order {
  id: string;
  status: string;
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

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <Link href={`/login?next=/orders/${id}`} className="text-brand underline">
        Sign in to view this order
      </Link>
    );
  if (!order) return <div className="text-danger">{err ?? 'Order not found'}</div>;

  const actions = actionsFor(order, meId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            <Link href={`/l/${order.listing?.id}`} className="hover:underline">
              {order.listing?.title ?? 'Order'}
            </Link>
          </h1>
          <div className="text-muted">{formatMoney(order.totalMinor, order.currency)}</div>
        </div>
        <Badge tone="brand">{order.status}</Badge>
      </div>

      {order.status === 'PENDING' && meId === order.buyerId && (
        <Button onClick={pay}>Pay now</Button>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.action} variant="outline" onClick={() => transition(a.action)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {err && <p className="text-sm text-warn">{err}</p>}

      <div>
        <h2 className="mb-2 font-semibold">Timeline</h2>
        <ol className="space-y-2 border-l pl-4">
          {order.timeline?.map((t, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand" />
              <div className="text-sm font-medium">{t.status}</div>
              <div className="text-xs text-muted">
                by {t.actor} · {timeAgo(t.at)}
                {t.note ? ` · ${t.note}` : ''}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
