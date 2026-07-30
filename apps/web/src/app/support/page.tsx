'use client';

import { useEffect, useState } from 'react';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { timeAgo } from '@/lib/format';
import { Badge, Button, Loading, PageHeader, SignInPrompt, inputClass } from '@/components/ui';

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

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/support" what="your support tickets" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Support" description="Open a ticket and we'll reply in this thread." />

      {open ? (
        <div className="space-y-3 rounded-lg bg-surface shadow-card p-4">
          <button onClick={() => setOpen(null)} className="text-footnote text-link hover:underline">
            ← All tickets
          </button>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{open.subject}</h2>
            <Badge tone={open.status === 'CLOSED' ? 'muted' : 'brand'}>{open.status}</Badge>
          </div>
          <ul className="space-y-2">
            {open.messages.map((m, i) => (
              <li key={i} className={`rounded-md border p-2 text-footnote ${m.staff ? 'bg-bg' : ''}`}>
                <div className="text-caption text-muted">{m.staff ? 'Support' : 'You'} · {timeAgo(m.at)}</div>
                {m.body}
              </li>
            ))}
          </ul>
          {open.status !== 'CLOSED' && (
            <div className="flex gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" className={`${inputClass} text-caption`} />
              <Button onClick={sendReply}>Send</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <form onSubmit={create} className="space-y-2 rounded-lg bg-surface shadow-card p-4">
            <h2 className="font-semibold">New ticket</h2>
            <input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={inputClass} />
            <textarea required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe your issue…" rows={3} className={inputClass} />
            <Button type="submit">Submit</Button>
          </form>

          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpen(t)} className="flex w-full items-center justify-between rounded-lg bg-surface shadow-card p-3 text-left hover:bg-bg">
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
