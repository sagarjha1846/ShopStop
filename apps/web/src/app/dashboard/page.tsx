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
interface Plan {
  plan: string;
  status: string | null;
  currentPeriodEnd: string | null;
  listingsPerHour: number;
}
interface BoostPricing {
  currency: string;
  pricePerDayMinor: number;
  maxDays: number;
  includedDaysRemaining: number;
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
interface Payouts {
  currency: string;
  settlementSlaDays: number;
  heldMinor: number;
  releasableMinor: number;
  withheldMinor: number;
  paidOutMinor: number;
  oldestHeldDays: number;
  payouts: Array<{
    batchId: string | null;
    reference: string | null;
    amountMinor: number;
    orders: number;
    paidAt: string;
  }>;
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
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [pricing, setPricing] = useState<BoostPricing | null>(null);
  const [boosting, setBoosting] = useState<string | null>(null);
  const [boostMsg, setBoostMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planMsg, setPlanMsg] = useState<string | null>(null);

  async function upgrade() {
    setPlanMsg(null);
    try {
      const q = await apiAuthed<{ amountMinor: number; currency: string }>('/subscriptions', { method: 'POST' });
      setPlanMsg(
        `Pro plan started at ${formatMoney(q.amountMinor, q.currency)}/month — complete payment at checkout to activate.`,
      );
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : 'Could not start the upgrade');
    }
  }

  /** Start a boost purchase. Placement only opens once the gateway confirms payment. */
  async function boost(listingId: string) {
    setBoosting(listingId);
    setBoostMsg(null);
    try {
      // Spend included plan days first when the seller has any.
      const days = pricing?.includedDaysRemaining ? Math.min(pricing.includedDaysRemaining, 7) : 7;
      const quote = await apiAuthed<{
        amountMinor: number;
        currency: string;
        creditDays: number;
        activated: boolean;
      }>(`/listings/${listingId}/boost`, { method: 'POST', body: { days } });

      if (quote.activated) {
        setBoostMsg(`Promoted for ${quote.creditDays} day(s) using your included credit.`);
        const [refreshed, freshPricing] = await Promise.all([
          apiAuthed<{ items: Listing[] }>(`/listings?sellerId=${me?.id}`),
          apiAuthed<BoostPricing>('/boosts/pricing'),
        ]);
        setListings(refreshed.items);
        setPricing(freshPricing);
      } else {
        // Mirrors the order pay flow: a real client opens gateway checkout with the
        // returned token, and the boost activates on the capture webhook.
        setBoostMsg(
          `Boost of ${formatMoney(quote.amountMinor, quote.currency)} started — complete payment at checkout to go live.`,
        );
      }
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
          const [b, s, l, e, p, pl, po] = await Promise.all([
            apiAuthed<Order[]>('/orders?role=buyer'),
            apiAuthed<Order[]>('/orders?role=seller'),
            apiAuthed<{ items: Listing[] }>(`/listings?sellerId=${meData.id}`),
            apiAuthed<Earnings>('/me/earnings'),
            apiAuthed<BoostPricing>('/boosts/pricing'),
            apiAuthed<Plan>('/me/subscription'),
            apiAuthed<Payouts>('/me/payouts'),
          ]);
          setBuying(b);
          setSelling(s);
          setListings(l.items);
          setEarnings(e);
          setPricing(p);
          setPlan(pl);
          setPayouts(po);
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
            {/* Not "paid out": this is what the sales earned after fees. What has
                actually been transferred lives in the Payouts panel below, and
                conflating the two tells a seller they have money they do not. */}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Earned (after fees)</dt>
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

      {payouts && (payouts.heldMinor > 0 || payouts.paidOutMinor > 0) && (
        <div className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Payouts</h2>
            <span className="text-xs text-muted">
              Released {payouts.settlementSlaDays} days after a sale is delivered
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Ready to pay out</dt>
              <dd className="text-lg font-semibold text-success">
                {formatMoney(payouts.releasableMinor, payouts.currency)}
              </dd>
              <p className="text-xs text-muted">delivered, no open dispute</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">On hold</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(payouts.withheldMinor, payouts.currency)}
              </dd>
              <p className="text-xs text-muted">until the buyer receives the item</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Total owed to you</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(payouts.heldMinor, payouts.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Paid to you</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(payouts.paidOutMinor, payouts.currency)}
              </dd>
              <p className="text-xs text-muted">lifetime</p>
            </div>
          </dl>
          {payouts.payouts.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Orders</th>
                    <th className="pb-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.payouts.map((p) => (
                    <tr key={p.batchId ?? p.paidAt} className="border-t">
                      <td className="py-2">{new Date(p.paidAt).toLocaleDateString()}</td>
                      <td className="py-2 font-medium">{formatMoney(p.amountMinor, payouts.currency)}</td>
                      <td className="py-2 text-muted">{p.orders}</td>
                      {/* The bank reference, so a seller can match a payout against
                          their own statement rather than taking our word for it. */}
                      <td className="py-2 font-mono text-xs text-muted">{p.reference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {plan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface p-4">
          <div>
            <h2 className="font-semibold">
              {plan.plan === 'PRO' ? 'ShopStop Pro' : 'Free plan'}
              {plan.status === 'CANCELLED' && <span className="ml-2 text-xs text-muted">(ends soon)</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">
              List up to {plan.listingsPerHour} items an hour.
              {plan.plan === 'PRO'
                ? plan.currentPeriodEnd
                  ? ` Renews ${new Date(plan.currentPeriodEnd).toLocaleDateString('en-IN')}.`
                  : ''
                : ' Upgrade for a higher limit and monthly promotion credit.'}
            </p>
          </div>
          {plan.plan !== 'PRO' && <Button onClick={upgrade}>Upgrade to Pro</Button>}
        </div>
      )}
      {planMsg && <p className="text-sm text-accent">{planMsg}</p>}

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
                        : pricing.includedDaysRemaining > 0
                          ? `Promote ${Math.min(pricing.includedDaysRemaining, 7)}d · included`
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
