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
interface Flag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
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
interface Payables {
  currency: string;
  settlementSlaDays: number;
  heldMinor: number;
  releasableMinor: number;
  withheldMinor: number;
  overdueMinor: number;
  sellerCount: number;
  orderCount: number;
  oldestHeldDays: number;
  aging: Array<{ bucket: string; minor: number; orders: number }>;
  bySeller: Array<{
    sellerId: string;
    handle: string;
    owedMinor: number;
    releasableMinor: number;
    orders: number;
    oldestHeldDays: number;
  }>;
  reconciliation: {
    collectedMinor: number;
    commissionMinor: number;
    refundedMinor: number;
    paidOutMinor: number;
    ledgerHeldMinor: number;
    orderHeldMinor: number;
    driftMinor: number;
    balanced: boolean;
  };
}

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string>('');
  const [fraud, setFraud] = useState<FraudEvent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [payables, setPayables] = useState<Payables | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);

  async function toggleFlag(key: string, enabled: boolean) {
    setMsg(null);
    const previous = flags;
    setFlags((f) => f.map((x) => (x.key === key ? { ...x, enabled } : x)));
    try {
      await apiAuthed(`/admin/feature-flags/${key}`, { method: 'PUT', body: { enabled } });
      setMsg(`${key} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      setFlags(previous);
      setMsg(e instanceof Error ? e.message : 'Could not change that flag');
    }
  }
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * Record a settlement already sent to the seller's bank. This does not move
   * money — no payout rail is wired up — so it asks for the transfer reference
   * first: a PAYOUT row that can't be traced to a real transfer is worse than none.
   */
  async function settle(sellerId: string, handle: string, amountMinor: number, currency: string) {
    const reference = window.prompt(
      `Record a payout of ${formatMoney(amountMinor, currency)} to @${handle}.\n\n` +
        `Enter the bank transfer reference (UTR) for the payment you have already sent:`,
    );
    if (!reference || reference.trim().length < 3) return;
    setSettling(sellerId);
    setSettleMsg(null);
    try {
      const res = await apiAuthed<{ settledMinor: number; orders: Array<unknown> }>(
        '/admin/payables/settle',
        { method: 'POST', body: { sellerId, reference: reference.trim() } },
      );
      setSettleMsg(
        res.settledMinor > 0
          ? `Recorded ${formatMoney(res.settledMinor, currency)} to @${handle} across ${res.orders.length} order(s).`
          : `Nothing was outstanding for @${handle} — no payout recorded.`,
      );
      setPayables(await apiAuthed<Payables>('/admin/payables'));
    } catch (e) {
      setSettleMsg(e instanceof Error ? e.message : 'Could not record the settlement');
    } finally {
      setSettling(null);
    }
  }

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
              const [rev, fun, fl, pay] = await Promise.all([
                apiAuthed<Revenue>('/admin/revenue?days=30'),
                apiAuthed<Funnel>('/admin/funnel?days=30'),
                apiAuthed<Flag[]>('/admin/feature-flags'),
                apiAuthed<Payables>('/admin/payables'),
              ]);
              setRevenue(rev);
              setFunnel(fun);
              setFlags(fl);
              setPayables(pay);
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

      {flags.length > 0 && (
        <section className="rounded-lg border bg-surface p-4">
          <h2 className="font-semibold">Switches</h2>
          <p className="mt-1 text-xs text-muted">
            Operational controls that take effect without a deploy. Every change is written to the
            audit log.
          </p>
          <ul className="mt-3 divide-y">
            {flags.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="max-w-xl">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted">{f.description}</div>
                  <code className="text-[11px] text-muted">{f.key}</code>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={f.enabled}
                    aria-label={`Toggle ${f.key}`}
                    onChange={(e) => toggleFlag(f.key, e.target.checked)}
                  />
                  <span className={f.enabled ? 'text-success' : 'text-muted'}>
                    {f.enabled ? 'On' : 'Off'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {payables && (
        <section className="rounded-lg border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Payables · money held for sellers</h2>
            <span className="text-xs text-muted">
              {payables.orderCount} order(s) · {payables.sellerCount} seller(s)
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Held (liability)</dt>
              <dd className="text-xl font-bold">{formatMoney(payables.heldMinor, payables.currency)}</dd>
              <p className="text-xs text-muted">oldest {payables.oldestHeldDays}d</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Ready to pay</dt>
              <dd className="text-xl font-bold text-success">
                {formatMoney(payables.releasableMinor, payables.currency)}
              </dd>
              <p className="text-xs text-muted">delivered, dispute-free</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Withheld</dt>
              <dd className="text-xl font-bold">
                {formatMoney(payables.withheldMinor, payables.currency)}
              </dd>
              <p className="text-xs text-muted">in transit or disputed</p>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Overdue</dt>
              <dd className={`text-xl font-bold ${payables.overdueMinor > 0 ? 'text-danger' : ''}`}>
                {formatMoney(payables.overdueMinor, payables.currency)}
              </dd>
              <p className="text-xs text-muted">past {payables.settlementSlaDays}d SLA</p>
            </div>
          </dl>

          {/* The liability is computed twice — from orders and from the ledger. If
              they disagree the books are wrong, and that is worth shouting about
              rather than hiding behind a reassuring total. */}
          <p
            className={`mt-3 text-xs ${payables.reconciliation.balanced ? 'text-muted' : 'font-semibold text-danger'}`}
          >
            {payables.reconciliation.balanced
              ? `Reconciled: collected ${formatMoney(payables.reconciliation.collectedMinor, payables.currency)} − commission ${formatMoney(payables.reconciliation.commissionMinor, payables.currency)} − refunds ${formatMoney(payables.reconciliation.refundedMinor, payables.currency)} − paid out ${formatMoney(payables.reconciliation.paidOutMinor, payables.currency)} = held.`
              : `LEDGER DRIFT of ${formatMoney(payables.reconciliation.driftMinor, payables.currency)} — orders and ledger disagree. Do not settle until this is explained.`}
          </p>

          {settleMsg && <p className="mt-2 text-sm">{settleMsg}</p>}

          {payables.bySeller.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 font-medium">Seller</th>
                    <th className="pb-2 font-medium">Owed</th>
                    <th className="pb-2 font-medium">Ready to pay</th>
                    <th className="pb-2 font-medium">Orders</th>
                    <th className="pb-2 font-medium">Oldest</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {payables.bySeller.map((s) => (
                    <tr key={s.sellerId} className="border-t">
                      <td className="py-2">@{s.handle}</td>
                      <td className="py-2 font-medium">{formatMoney(s.owedMinor, payables.currency)}</td>
                      <td className="py-2 text-success">
                        {formatMoney(s.releasableMinor, payables.currency)}
                      </td>
                      <td className="py-2 text-muted">{s.orders}</td>
                      <td className="py-2 text-muted">{s.oldestHeldDays}d</td>
                      <td className="py-2 text-right">
                        <Button
                          variant="outline"
                          className="px-3 py-1 text-xs"
                          disabled={
                            s.releasableMinor <= 0 ||
                            settling === s.sellerId ||
                            !payables.reconciliation.balanced
                          }
                          onClick={() =>
                            settle(s.sellerId, s.handle, s.releasableMinor, payables.currency)
                          }
                        >
                          {settling === s.sellerId ? 'Recording…' : 'Record payout'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">
                Recording a payout writes the ledger rows for a transfer you have already sent from
                the bank. It does not move money.
              </p>
            </div>
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
