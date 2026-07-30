'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { formatMoney, timeAgo } from '@/lib/format';
import { Badge, Button, EmptyState, LinkButton, Loading, PageHeader } from '@/components/ui';

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

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string>('');
  const [fraud, setFraud] = useState<FraudEvent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
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

  if (!ready) return <Loading />;
  if (role !== 'ADMIN' && role !== 'MODERATOR')
    return (
      <EmptyState
        title="You don't have access to this area"
        body="The moderation console is limited to admins and moderators."
        action={<LinkButton href="/login?next=/admin">Sign in with an admin account</LinkButton>}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Trust &amp; Safety" description="Fraud holds, reports and disputes." />
      {msg && <p className="text-footnote text-accent">{msg}</p>}

      <section>
        <h2 className="mb-2 font-semibold">Fraud queue ({fraud.length})</h2>
        {fraud.length === 0 ? (
          <p className="text-muted">No open fraud events.</p>
        ) : (
          <ul className="space-y-2">
            {fraud.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg bg-surface shadow-card p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={f.riskScore >= 70 ? 'danger' : 'warn'}>risk {f.riskScore}</Badge>
                    <span className="text-footnote font-medium">{f.signal}</span>
                  </div>
                  <div className="text-caption text-muted">
                    {f.user?.email ?? 'user'} · {timeAgo(f.createdAt)}
                  </div>
                </div>
                {f.listingId && (
                  <div className="flex gap-2">
                    <Button className="px-2 py-1 text-caption" onClick={() => actOnListing(f.listingId!, 'APPROVE')}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-caption"
                      onClick={() => actOnListing(f.listingId!, 'REJECT')}
                    >
                      Reject
                    </Button>
                    <Link href={`/l/${f.listingId}`} className="self-center text-caption text-link hover:underline">
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
              <li key={r.id} className="flex items-center justify-between rounded-lg bg-surface shadow-card p-3">
                <div>
                  <span className="text-footnote font-medium">{r.subjectType}</span>
                  <div className="text-caption text-muted">
                    {r.reason} · {timeAgo(r.createdAt)}
                  </div>
                </div>
                {r.listingId && (
                  <div className="flex gap-2">
                    <Button className="px-2 py-1 text-caption" onClick={() => actOnListing(r.listingId!, 'APPROVE')}>
                      Dismiss
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2 py-1 text-caption"
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
              <li key={d.id} className="rounded-lg bg-surface shadow-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-footnote font-medium">{d.reason}</span>
                  <Badge tone="warn">{d.status}</Badge>
                </div>
                {d.order && (
                  <div className="text-caption text-muted">
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
