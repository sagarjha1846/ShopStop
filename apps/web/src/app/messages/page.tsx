'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Socket } from 'socket.io-client';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { getSocket, closeSocket } from '@/lib/socket';
import { formatMoney, timeAgo } from '@/lib/format';
import { Button } from '@/components/ui';

interface Thread {
  id: string;
  lastMessageAt: string;
  listing?: { id: string; title: string; priceMinor: number; currency: string } | null;
  participants: { userId: string; user?: { profile?: { displayName: string } | null } }[];
  messages: { body: string | null; kind: string }[];
}
interface Message {
  id: string;
  threadId: string;
  senderId: string;
  kind: string;
  body: string | null;
  offerMinor: number | null;
  offerStatus: string | null;
  createdAt: string;
}

export default function MessagesPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [meId, setMeId] = useState<string>('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [offer, setOffer] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const loadMessages = useCallback(async (threadId: string) => {
    const res = await apiAuthed<{ items: Message[] }>(`/threads/${threadId}/messages?limit=50`);
    setMessages([...res.items].reverse());
  }, []);

  // Realtime: append live messages for the open thread; refresh list ordering.
  useEffect(() => {
    if (!authed) return;
    const s = getSocket();
    socketRef.current = s;
    const onNew = (m: Message) => {
      if (m.threadId === activeRef.current) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      }
    };
    const onThreadUpdated = async () => {
      try {
        setThreads(await apiAuthed<Thread[]>('/threads'));
      } catch {
        /* ignore */
      }
    };
    const onConnect = () => {
      if (activeRef.current) s.emit('thread:join', activeRef.current);
    };
    s.on('message:new', onNew);
    s.on('thread:updated', onThreadUpdated);
    s.on('connect', onConnect);
    if (s.connected) onConnect();
    return () => {
      s.off('message:new', onNew);
      s.off('thread:updated', onThreadUpdated);
      s.off('connect', onConnect);
    };
  }, [authed]);

  useEffect(() => () => closeSocket(), []);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const me = await apiAuthed<{ id: string }>('/me/profile');
          setMeId(me.id);
          const t = await apiAuthed<Thread[]>('/threads');
          setThreads(t);
          if (t[0]) {
            setActive(t[0].id);
            await loadMessages(t[0].id);
          }
        } catch {
          /* empty */
        }
      }
      setReady(true);
    })();
  }, [loadMessages]);

  async function open(id: string) {
    setActive(id);
    socketRef.current?.emit('thread:join', id);
    await loadMessages(id);
  }
  async function send() {
    if (!active || !text.trim()) return;
    await apiAuthed(`/threads/${active}/messages`, { method: 'POST', body: { kind: 'TEXT', body: text } });
    setText('');
    await loadMessages(active);
  }
  async function sendOffer() {
    if (!active || !offer) return;
    await apiAuthed(`/threads/${active}/messages`, {
      method: 'POST',
      body: { kind: 'OFFER', offerMinor: Math.round(Number(offer) * 100) },
    });
    setOffer('');
    await loadMessages(active);
  }
  async function respond(messageId: string, action: 'accept' | 'decline') {
    await apiAuthed(`/threads/messages/${messageId}/offer`, { method: 'POST', body: { action } });
    if (active) await loadMessages(active);
  }

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <div className="mx-auto max-w-sm text-center">
        <Link href="/login?next=/messages" className="text-brand underline">
          Sign in to view messages
        </Link>
      </div>
    );

  return (
    <div className="grid h-[70vh] gap-4 md:grid-cols-[280px_1fr]">
      <aside className="overflow-y-auto rounded-lg border bg-surface">
        {threads.length === 0 && <p className="p-4 text-sm text-muted">No conversations yet.</p>}
        {threads.map((t) => (
          <button
            key={t.id}
            onClick={() => open(t.id)}
            className={`block w-full border-b p-3 text-left hover:bg-bg ${active === t.id ? 'bg-bg' : ''}`}
          >
            <div className="line-clamp-1 text-sm font-medium">{t.listing?.title ?? 'Conversation'}</div>
            <div className="line-clamp-1 text-xs text-muted">{t.messages[0]?.body ?? '…'}</div>
          </button>
        ))}
      </aside>

      <section className="flex flex-col rounded-lg border bg-surface">
        {!active ? (
          <div className="flex flex-1 items-center justify-center text-muted">Select a conversation</div>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.map((m) => {
                const mine = m.senderId === meId;
                if (m.kind === 'SYSTEM')
                  return (
                    <div key={m.id} className="text-center text-xs text-muted">
                      {m.body}
                    </div>
                  );
                if (m.kind === 'OFFER')
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className="rounded-lg border bg-bg p-3 text-sm">
                        <div className="font-medium">Offer: {formatMoney(m.offerMinor ?? 0)}</div>
                        <div className="text-xs text-muted">{m.offerStatus}</div>
                        {!mine && m.offerStatus === 'OPEN' && (
                          <div className="mt-2 flex gap-2">
                            <Button className="px-2 py-1 text-xs" onClick={() => respond(m.id, 'accept')}>
                              Accept
                            </Button>
                            <Button
                              variant="outline"
                              className="px-2 py-1 text-xs"
                              onClick={() => respond(m.id, 'decline')}
                            >
                              Decline
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-brand text-brand-fg' : 'border bg-bg'}`}
                    >
                      {m.body}
                      <div className="mt-0.5 text-[10px] opacity-70">{timeAgo(m.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2 border-t p-3">
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a message…"
                  className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm"
                />
                <Button onClick={send}>Send</Button>
              </div>
              <div className="flex gap-2">
                <input
                  value={offer}
                  onChange={(e) => setOffer(e.target.value)}
                  type="number"
                  placeholder="Make an offer (₹)"
                  className="flex-1 rounded-md border bg-bg px-3 py-2 text-sm"
                />
                <Button variant="outline" onClick={sendOffer}>
                  Offer
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
