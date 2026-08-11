'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

interface Order {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  listing?: { id: string; title: string };
  payment?: { status: string } | null;
}
interface Listing {
  id: string;
  title: string;
  status: string;
  priceMinor: number;
  currency: string;
  boostedUntil?: string | null;
}
interface BoostPricing {
  currency: string;
  pricePerDayMinor: number;
  maxDays: number;
}
interface Me {
  id: string;
  email: string;
  profile?: { handle: string; displayName: string } | null;
  trustScore?: { score: number } | null;
}
interface EarningsSplit {
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  orders: number;
}
interface Earnings {
  currency: string;
  feeBps: number;
  settled: EarningsSplit;
  pending: EarningsSplit;
  lifetimeNetMinor: number;
}

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warn' | 'danger' | 'brand'> = {
  PENDING: 'warn',
  ACCEPTED: 'brand',
  PACKED: 'brand',
  SHIPPED: 'brand',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  REJECTED: 'danger',
  REFUNDED: 'muted',
  ACTIVE: 'success',
  SOLD: 'muted',
  PENDING_REVIEW: 'warn',
};

export default function DashboardPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'buying' | 'selling' | 'listings'>('buying');
  const [buying, setBuying] = useState<Order[]>([]);
  const [selling, setSelling] = useState<Order[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [pricing, setPricing] = useState<BoostPricing | null>(null);
  const [boosting, setBoosting] = useState<string | null>(null);
  const [boostMsg, setBoostMsg] = useState<string | null>(null);

  /** Start a boost purchase. Placement only opens once the gateway confirms payment. */
  async function boost(listingId: string) {
    setBoosting(listingId);
    setBoostMsg(null);
    try {
      const quote = await apiAuthed<{ amountMinor: number; currency: string }>(
        `/listings/${listingId}/boost`,
        { method: 'POST', body: { days: 7 } },
      );
      // Mirrors the order pay flow: a real client opens gateway checkout with the
      // returned token, and the boost activates on the capture webhook.
      setBoostMsg(
        `Boost of ${formatMoney(quote.amountMinor, quote.currency)} started — complete payment at checkout to go live.`,
      );
    } catch (e) {
      setBoostMsg(e instanceof Error ? e.message : 'Could not start the boost');
    } finally {
      setBoosting(null);
    }
  }

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const meData = await apiAuthed<Me>('/me/profile');
          setMe(meData);
          const [b, s, l, e, p] = await Promise.all([
            apiAuthed<Order[]>('/orders?role=buyer'),
            apiAuthed<Order[]>('/orders?role=seller'),
            apiAuthed<{ items: Listing[] }>(`/listings?sellerId=${meData.id}`),
            apiAuthed<Earnings>('/me/earnings'),
            apiAuthed<BoostPricing>('/boosts/pricing'),
          ]);
          setBuying(b);
          setSelling(s);
          setListings(l.items);
          setEarnings(e);
          setPricing(p);
        } catch {
          /* ignore; show empty */
        }
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <div className="mx-auto max-w-sm space-y-3 text-center">
        <p>Please sign in to view your dashboard.</p>
        <Link href="/login?next=/dashboard" className="text-brand underline">
          Sign in
        </Link>
      </div>
    );

  const orders = tab === 'buying' ? buying : selling;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {me?.profile && (
          <Link href={`/u/${me.profile.handle}`} className="text-sm text-brand underline">
            View public profile
          </Link>
        )}
      </div>

      {earnings && (earnings.settled.orders > 0 || earnings.pending.orders > 0) && (
        <div className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Earnings</h2>
            <span className="text-xs text-muted">
              Platform fee {(earnings.feeBps / 100).toFixed(2)}%
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Paid out to you</dt>
              <dd className="text-lg font-semibold text-success">
                {formatMoney(earnings.settled.netMinor, earnings.currency)}
              </dd>
              <p className="text-xs text-muted">{earnings.settled.orders} order(s)</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Sales (gross)</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(earnings.settled.grossMinor, earnings.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Platform fees</dt>
              <dd className="text-lg font-semibold text-muted">
                −{formatMoney(earnings.settled.feeMinor, earnings.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">In flight</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(earnings.pending.netMinor, earnings.currency)}
              </dd>
              <p className="text-xs text-muted">{earnings.pending.orders} awaiting payment</p>
            </div>
          </dl>
        </div>
      )}

      <div className="flex gap-2 border-b">
        {(['buying', 'selling', 'listings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-brand font-medium' : 'text-muted'}`}
          >
            {t === 'listings' ? 'My listings' : t}
          </button>
        ))}
      </div>

      {tab !== 'listings' ? (
        orders.length === 0 ? (
          <p className="text-muted">No orders yet.</p>
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between rounded-lg border bg-surface p-3">
                <div>
                  <Link href={`/l/${o.listing?.id}`} className="font-medium hover:underline">
                    {o.listing?.title ?? 'Listing'}
                  </Link>
                  <div className="text-sm text-muted">
                    {formatMoney(o.totalMinor, o.currency)}
                    {o.payment?.status ? ` · ${o.payment.status.toLowerCase()}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={STATUS_TONE[o.status] ?? 'muted'}>{o.status}</Badge>
                  <Link href={`/orders/${o.id}`} className="text-sm text-brand hover:underline">
                    Details →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : listings.length === 0 ? (
        <p className="text-muted">
          No listings yet.{' '}
          <Link href="/sell" className="text-brand underline">
            Create one.
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {listings.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-surface p-3">
              <Link href={`/l/${l.id}`} className="font-medium hover:underline">
                {l.title}
              </Link>
              <div className="flex items-center gap-3">
                <span className="text-sm">{formatMoney(l.priceMinor, l.currency)}</span>
                <Badge tone={STATUS_TONE[l.status] ?? 'muted'}>{l.status}</Badge>
                {l.boostedUntil && new Date(l.boostedUntil) > new Date() ? (
                  <Badge tone="brand">Promoted</Badge>
                ) : (
                  l.status === 'ACTIVE' &&
                  pricing && (
                    <Button
                      variant="outline"
                      onClick={() => boost(l.id)}
                      disabled={boosting === l.id}
                      className="text-xs"
                    >
                      {boosting === l.id
                        ? 'Starting…'
                        : `Promote 7d · ${formatMoney(pricing.pricePerDayMinor * 7, pricing.currency)}`}
                    </Button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {boostMsg && <p className="text-sm text-accent">{boostMsg}</p>}
    </div>
  );
}
