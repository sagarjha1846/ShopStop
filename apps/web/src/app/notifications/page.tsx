'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { getSocket } from '@/lib/socket';
import { timeAgo } from '@/lib/format';
import { Button, Loading, SignInPrompt } from '@/components/ui';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function hrefFor(n: Notification): string {
  const d = n.data ?? {};
  if (typeof d.orderId === 'string') return `/orders/${d.orderId}`;
  if (typeof d.threadId === 'string') return `/messages`;
  return '#';
}

export default function NotificationsPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);

  async function load() {
    setItems(await apiAuthed<Notification[]>('/notifications'));
  }

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          await load();
        } catch {
          /* ignore */
        }
        const s = getSocket();
        const onNotif = () => load().catch(() => undefined);
        s.on('notification:new', onNotif);
      }
      setReady(true);
    })();
  }, []);

  async function markAllRead() {
    await apiAuthed('/notifications/read-all', { method: 'POST' });
    await load();
  }

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/notifications" what="your notifications" />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-title font-semibold">Notifications</h1>
        {items.some((n) => !n.readAt) && (
          <Button variant="outline" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-muted">No notifications yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <Link
                href={hrefFor(n)}
                className={`block rounded-lg border p-3 transition hover:bg-bg ${n.readAt ? 'bg-surface' : 'bg-surface ring-1 ring-brand'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{n.title}</span>
                  <span className="text-caption text-muted">{timeAgo(n.createdAt)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-footnote text-muted">{n.body}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
