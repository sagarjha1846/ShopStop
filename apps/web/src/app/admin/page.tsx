'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney, timeAgo } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

interface FraudEvent {
  id: string;
  signal: string;
  riskScore: number;
  createdAt: string;
  listingId: string | null;
  user?: { id: string; email: string; status: string } | null;
}
interface Report {
  id: string;
  subjectType: string;
  listingId: string | null;
  reportedUserId: string | null;
  reason: string;
  createdAt: string;
}
interface Dispute {
  id: string;
  reason: string;
  status: string;
  order?: { id: string; totalMinor: number; currency: string } | null;
}
interface FunnelMetric {
  key: string;
  label: string;
  value: number | null;
  unit: 'pct' | 'count' | 'per100';
  numerator: number;
  denominator: number;
  target: number | null;
  targetDirection: 'gte' | 'lte';
  meets: boolean | null;
  note?: string;
}
interface Funnel {
  windowDays: number;
  northStarPerWeek: number | null;
  metrics: FunnelMetric[];
  notMeasurable: Array<{ metric: string; reason: string }>;
}
interface Revenue {
  currency: string;
  feeBps: number;
  gmvMinor: number;
  feeRevenueMinor: number;
  refundedMinor: number;
  paidOrders: number;
  averageOrderValueMinor: number;
  takeRatePct: number;
  byDay: Array<{ day: string; gmvMinor: number; feeRevenueMinor: number; orders: number }>;
  byMethod: Array<{
    method: string;
    gmvMinor: number;
    orders: number;
    commissionMinor: number;
    estGatewayCostMinor: number;
    estNetMinor: number;
  }>;
  estNetCommissionMinor: number;
}

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string>('');
  const [fraud, setFraud] = useState<FraudEvent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const [q, d] = await Promise.all([
      apiAuthed<{ fraud: FraudEvent[]; reports: Report[] }>('/admin/moderation/queue'),
      apiAuthed<Dispute[]>('/admin/disputes'),
    ]);
    setFraud(q.fraud);
    setReports(q.reports);
    setDisputes(d);
  }, []);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      if (ok) {
        try {
          const me = await apiAuthed<{ role: string }>('/me/profile');
          setRole(me.role);
          if (me.role === 'ADMIN' || me.role === 'MODERATOR') await loadQueue();
          // Revenue is the company's P&L — admins only, not moderators.
          if (me.role === 'ADMIN') {
            try {
              const [rev, fun] = await Promise.all([
                apiAuthed<Revenue>('/admin/revenue?days=30'),
                apiAuthed<Funnel>('/admin/funnel?days=30'),
              ]);
              setRevenue(rev);
              setFunnel(fun);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      }
      setReady(true);
    })();
  }, [loadQueue]);

  async function actOnListing(listingId: string, decision: 'APPROVE' | 'REJECT') {
    setMsg(null);
    try {
      await apiAuthed(`/admin/moderation/LISTING/${listingId}/action`, {
        method: 'POST',
        body: { decision },
      });
      setMsg(`Listing ${decision.toLowerCase()}d.`);
      await loadQueue();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Action failed');
    }
  }

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (role !== 'ADMIN' && role !== 'MODERATOR')
    return (
      <div className="mx-auto max-w-sm text-center text-muted">
        <p>Admin access required.</p>
        <Link href="/login?next=/admin" className="text-brand underline">
          Sign in as an admin
        </Link>
      </div>
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Trust &amp; Safety console</h1>
      {msg && <p className="text-sm text-accent">{msg}</p>}

      {funnel && (
        <section className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Is the marketplace working?</h2>
            <span className="text-xs text-muted">last {funnel.windowDays} days</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            North star — dispute-free transactions per week:{' '}
            <span className="font-semibold text-ink">{funnel.northStarPerWeek ?? '—'}</span>
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1 font-medium">Metric</th>
                  <th className="py-1 text-right font-medium">Actual</th>
                  <th className="py-1 text-right font-medium">Counts</th>
                  <th className="py-1 text-right font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {funnel.metrics.map((m) => (
                  <tr key={m.key}>
                    <td className="py-1">
                      {m.label}
                      {m.note && <span className="block text-xs text-muted">{m.note}</span>}
                    </td>
                    <td
                      className={`py-1 text-right font-medium ${
                        m.meets === null ? 'text-muted' : m.meets ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {m.value === null ? 'no data' : m.unit === 'pct' ? `${m.value}%` : m.value}
                    </td>
                    <td className="py-1 text-right text-xs text-muted">
                      {m.unit === 'count' ? '—' : `${m.numerator}/${m.denominator}`}
                    </td>
                    <td className="py-1 text-right text-muted">
                      {m.target === null ? '—' : `${m.targetDirection === 'gte' ? '≥' : '≤'}${m.target}${m.unit === 'pct' ? '%' : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {funnel.notMeasurable.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Not measurable yet: {funnel.notMeasurable.map((x) => x.metric).join('; ')}.
            </p>
          )}
        </section>
      )}

      {revenue && (
        <section className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Revenue · last 30 days</h2>
            <span className="text-xs text-muted">Fee {(revenue.feeBps / 100).toFixed(2)}%</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Platform revenue</dt>
              <dd className="text-xl font-bold text-success">
                {formatMoney(revenue.feeRevenueMinor, revenue.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">GMV</dt>
              <dd className="text-xl font-bold">{formatMoney(revenue.gmvMinor, revenue.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Paid orders</dt>
              <dd className="text-xl font-bold">{revenue.paidOrders}</dd>
              <p className="text-xs text-muted">
                avg {formatMoney(revenue.averageOrderValueMinor, revenue.currency)}
              </p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Commission after gateway</dt>
              <dd
                className={`text-xl font-bold ${revenue.estNetCommissionMinor > 0 ? 'text-success' : 'text-danger'}`}
              >
                {formatMoney(revenue.estNetCommissionMinor, revenue.currency)}
              </dd>
              <p className="text-xs text-muted">est · take rate {revenue.takeRatePct}%</p>
            </div>
          </dl>

          {revenue.byMethod.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Does the commission actually earn?</h3>
              <p className="mt-1 text-xs text-muted">
                Commission is priced near card processing cost, so margin depends on payment mix.
                Gateway cost is estimated — replace the assumed rates with your contracted ones.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="py-1 font-medium">Method</th>
                      <th className="py-1 text-right font-medium">GMV</th>
                      <th className="py-1 text-right font-medium">Commission</th>
                      <th className="py-1 text-right font-medium">Gateway (est)</th>
                      <th className="py-1 text-right font-medium">Net (est)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {revenue.byMethod.map((m) => (
                      <tr key={m.method}>
                        <td className="py-1 uppercase">{m.method}</td>
                        <td className="py-1 text-right">{formatMoney(m.gmvMinor, revenue.currency)}</td>
                        <td className="py-1 text-right">
                          {formatMoney(m.commissionMinor, revenue.currency)}
                        </td>
                        <td className="py-1 text-right text-muted">
                          −{formatMoney(m.estGatewayCostMinor, revenue.currency)}
                        </td>
                        <td
                          className={`py-1 text-right font-medium ${m.estNetMinor > 0 ? 'text-success' : 'text-danger'}`}
                        >
                          {formatMoney(m.estNetMinor, revenue.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {revenue.byDay.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 text-right font-medium">GMV</th>
                    <th className="py-1 text-right font-medium">Revenue</th>
                    <th className="py-1 text-right font-medium">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {revenue.byDay.slice(0, 10).map((d) => (
                    <tr key={d.day}>
                      <td className="py-1">{d.day}</td>
                      <td className="py-1 text-right">{formatMoney(d.gmvMinor, revenue.currency)}</td>
                      <td className="py-1 text-right text-success">
                        {formatMoney(d.feeRevenueMinor, revenue.currency)}
                      </td>
                      <td className="py-1 text-right">{d.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Fraud queue ({fraud.length})</h2>
        {fraud.length === 0 ? (
          <p className="text-muted">No open fraud events.</p>
        ) : (
          <ul className="space-y-2">
            {fraud.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border bg-surface p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={f.riskScore >= 70 ? 'danger' : 'warn'}>risk {f.riskScore}</Badge>
                    <span className="text-sm font-medium">{f.signal}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {f.user?.email ?? 'user'} · {timeAgo(f.createdAt)}
                  </div>
                </div>
                {f.listingId && (
                  <div className="flex gap-2">
                    <Button className="px-2 py-1 text-xs" onClick={() => actOnListing(f.listingId!, 'APPROVE')}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-xs"
                      onClick={() => actOnListing(f.listingId!, 'REJECT')}
                    >
                      Reject
                    </Button>
                    <Link href={`/l/${f.listingId}`} className="self-center text-xs text-brand underline">
                      view
                    </Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Reports ({reports.length})</h2>
        {reports.length === 0 ? (
          <p className="text-muted">No open reports.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border bg-surface p-3">
                <div>
                  <span className="text-sm font-medium">{r.subjectType}</span>
                  <div className="text-xs text-muted">
                    {r.reason} · {timeAgo(r.createdAt)}
                  </div>
                </div>
                {r.listingId && (
                  <div className="flex gap-2">
                    <Button className="px-2 py-1 text-xs" onClick={() => actOnListing(r.listingId!, 'APPROVE')}>
                      Dismiss
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-xs"
                      onClick={() => actOnListing(r.listingId!, 'REJECT')}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Open disputes ({disputes.length})</h2>
        {disputes.length === 0 ? (
          <p className="text-muted">No open disputes.</p>
        ) : (
          <ul className="space-y-2">
            {disputes.map((d) => (
              <li key={d.id} className="rounded-lg border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{d.reason}</span>
                  <Badge tone="warn">{d.status}</Badge>
                </div>
                {d.order && (
                  <div className="text-xs text-muted">
                    Order {formatMoney(d.order.totalMinor, d.order.currency)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
