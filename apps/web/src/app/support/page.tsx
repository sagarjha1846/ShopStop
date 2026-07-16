'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { timeAgo } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

interface Ticket {
  id: string;
  subject: string;
  status: string;
  messages: { authorId: string; staff: boolean; body: string; at: string }[];
  updatedAt: string;
}

export default function SupportPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');

  async function load() {
    setTickets(await apiAuthed<Ticket[]>('/support'));
  }
  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) await load().catch(() => undefined);
      setReady(true);
    })();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await apiAuthed('/support', { method: 'POST', body: { subject, body } });
    setSubject('');
    setBody('');
    await load();
  }
  async function sendReply() {
    if (!open || !reply.trim()) return;
    const t = await apiAuthed<Ticket>(`/support/${open.id}/reply`, { method: 'POST', body: { body: reply } });
    setOpen(t);
    setReply('');
    await load();
  }

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <Link href="/login?next=/support" className="text-brand underline">
        Sign in to contact support
      </Link>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Support</h1>

      {open ? (
        <div className="space-y-3 rounded-lg border bg-surface p-4">
          <button onClick={() => setOpen(null)} className="text-sm text-brand underline">
            ← All tickets
          </button>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{open.subject}</h2>
            <Badge tone={open.status === 'CLOSED' ? 'muted' : 'brand'}>{open.status}</Badge>
          </div>
          <ul className="space-y-2">
            {open.messages.map((m, i) => (
              <li key={i} className={`rounded-md border p-2 text-sm ${m.staff ? 'bg-bg' : ''}`}>
                <div className="text-xs text-muted">{m.staff ? 'Support' : 'You'} · {timeAgo(m.at)}</div>
                {m.body}
              </li>
            ))}
          </ul>
          {open.status !== 'CLOSED' && (
            <div className="flex gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm" />
              <Button onClick={sendReply}>Send</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <form onSubmit={create} className="space-y-2 rounded-lg border bg-surface p-4">
            <h2 className="font-semibold">New ticket</h2>
            <input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full rounded-md border bg-bg px-3 py-2" />
            <textarea required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe your issue…" rows={3} className="w-full rounded-md border bg-bg px-3 py-2" />
            <Button type="submit">Submit</Button>
          </form>

          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpen(t)} className="flex w-full items-center justify-between rounded-lg border bg-surface p-3 text-left hover:bg-bg">
                  <span className="font-medium">{t.subject}</span>
                  <Badge tone={t.status === 'CLOSED' ? 'muted' : 'brand'}>{t.status}</Badge>
                </button>
              </li>
            ))}
            {tickets.length === 0 && <p className="text-muted">No tickets yet.</p>}
          </ul>
        </>
      )}
    </div>
  );
}
