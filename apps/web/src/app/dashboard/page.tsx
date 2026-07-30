'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  Loading,
  PageHeader,
  SignInPrompt,
} from '@/components/ui';

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

// Name states the way a person would, not the way the database does.
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting payment',
  ACCEPTED: 'Paid',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REJECTED: 'Declined',
  REFUNDED: 'Refunded',
  ACTIVE: 'Live',
  SOLD: 'Sold',
  DRAFT: 'Draft',
  PAUSED: 'Paused',
  PENDING_REVIEW: 'In review',
};

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

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/dashboard" what="your dashboard" />;

  const orders = tab === 'buying' ? buying : selling;
  const TABS = [
    ['buying', 'Buying', buying.length],
    ['selling', 'Selling', selling.length],
    ['listings', 'My listings', listings.length],
  ] as const;

  return (
    <div className="py-4">
      <PageHeader
        title="Dashboard"
        action={
          me?.profile && (
            <LinkButton href={`/u/${me.profile.handle}`} variant="secondary" size="sm">
              View public profile
            </LinkButton>
          )
        }
      />

      {/* Segmented control: the selected tab is a filled pill, not an underline. */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="mb-6 inline-flex gap-1 rounded-pill bg-sunken p-1"
      >
        {TABS.map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-1.5 text-caption font-medium transition-colors duration-200 ${
              tab === key ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text'
            }`}
          >
            {label}
            {count > 0 && <span className="tabular ml-1.5 text-faint">{count}</span>}
          </button>
        ))}
      </div>

      {tab !== 'listings' ? (
        orders.length === 0 ? (
          <EmptyState
            title={tab === 'buying' ? 'No purchases yet' : 'No sales yet'}
            body={
              tab === 'buying'
                ? 'Orders you place will show up here with their delivery status.'
                : 'When someone buys one of your listings, the order appears here.'
            }
            action={
              <LinkButton href={tab === 'buying' ? '/search' : '/sell'}>
                {tab === 'buying' ? 'Browse listings' : 'Create a listing'}
              </LinkButton>
            }
          />
        ) : (
          <ul className="space-y-2">
            {orders.map((o) => (
              <Card key={o.id} as="li">
                <Link
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-footnote font-medium">
                      {o.listing?.title ?? 'Listing'}
                    </p>
                    <p className="tabular mt-0.5 text-caption text-muted">
                      {formatMoney(o.totalMinor, o.currency)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[o.status] ?? 'muted'}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </Badge>
                </Link>
              </Card>
            ))}
          </ul>
        )
      ) : listings.length === 0 ? (
        <EmptyState
          title="You haven't listed anything"
          body="Listing takes about a minute, and verified sellers sell faster."
          action={<LinkButton href="/sell">Create a listing</LinkButton>}
        />
      ) : (
        <ul className="space-y-2">
          {listings.map((l) => (
            <Card key={l.id} as="li">
              <Link href={`/l/${l.id}`} className="flex items-center justify-between gap-4 p-4">
                <p className="min-w-0 truncate text-footnote font-medium">{l.title}</p>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-caption">
                    {formatMoney(l.priceMinor, l.currency)}
                  </span>
                  <Badge tone={STATUS_TONE[l.status] ?? 'muted'}>
                    {STATUS_LABEL[l.status] ?? l.status}
                  </Badge>
                </div>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
