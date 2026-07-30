'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { getSocket } from '@/lib/socket';
import { BellIcon } from './icons';

/** Header bell: shows unread count, updates live on notification:new. */
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);
  // The header never remounts on client navigation, so without this the bell stays
  // hidden for the rest of the session after someone signs in.
  const pathname = usePathname();

  useEffect(() => {
    if (count !== null) return;
    let cancelled = false;
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      if (!ok || cancelled) return;
      try {
        const { count: c } = await apiAuthed<{ count: number }>('/notifications/unread-count');
        if (!cancelled) setCount(c);
      } catch {
        /* not signed in */
      }
      const s = getSocket();
      const onNotif = () => setCount((c) => (c ?? 0) + 1);
      s.on('notification:new', onNotif);
      return () => s.off('notification:new', onNotif);
    })();
    return () => {
      cancelled = true;
    };
    // `count` is intentionally excluded: it is a run-once guard, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Hidden until we know the user is signed in.
  if (count === null) return null;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-pill text-muted transition-colors duration-200 hover:bg-sunken hover:text-text"
    >
      <BellIcon />
      {count > 0 && (
        <span className="absolute right-1 top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-semibold leading-none text-white">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
