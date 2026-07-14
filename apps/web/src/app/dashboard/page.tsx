'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui';

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
}
interface Me {
  id: string;
  email: string;
  profile?: { handle: string; displayName: string } | null;
  trustScore?: { score: number } | null;
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

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const meData = await apiAuthed<Me>('/me/profile');
          setMe(meData);
          const [b, s, l] = await Promise.all([
            apiAuthed<Order[]>('/orders?role=buyer'),
            apiAuthed<Order[]>('/orders?role=seller'),
            apiAuthed<{ items: Listing[] }>(`/listings?sellerId=${meData.id}`),
          ]);
          setBuying(b);
          setSelling(s);
          setListings(l.items);
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
                <Badge tone={STATUS_TONE[o.status] ?? 'muted'}>{o.status}</Badge>
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
            <li key={l.id} className="flex items-center justify-between rounded-lg border bg-surface p-3">
              <Link href={`/l/${l.id}`} className="font-medium hover:underline">
                {l.title}
              </Link>
              <div className="flex items-center gap-3">
                <span className="text-sm">{formatMoney(l.priceMinor, l.currency)}</span>
                <Badge tone={STATUS_TONE[l.status] ?? 'muted'}>{l.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
