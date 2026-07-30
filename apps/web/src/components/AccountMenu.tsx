'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiAuthed, getAccessToken, logout, refresh } from '@/lib/auth-client';
import { LinkButton } from './ui';

interface Me {
  id: string;
  profile?: { handle: string; displayName: string } | null;
}

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/wishlist', label: 'Saved items' },
  { href: '/addresses', label: 'Addresses' },
  { href: '/support', label: 'Support' },
  { href: '/settings', label: 'Settings' },
];

/**
 * The header's account control. Signed out it is the one filled button in the bar;
 * signed in it becomes an initial-avatar menu — previously the header showed
 * "Sign in" to everyone, including people who were already signed in, and there was
 * no way to sign out at all.
 */
export function AccountMenu() {
  const router = useRouter();
  // The header lives in the root layout, so it does not remount when the user
  // navigates after signing in. Re-checking on pathname change is what makes the
  // control reflect the session immediately instead of after a full reload.
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Once a signed-in user is resolved, stop re-fetching on every navigation.
  // Cleared on sign-out so the control drops back to "Sign in".
  const resolved = useRef(false);

  useEffect(() => {
    if (resolved.current) return;
    let cancelled = false;
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      if (ok) {
        try {
          const data = await apiAuthed<Me>('/me/profile');
          if (!cancelled) {
            resolved.current = true;
            setMe(data);
          }
        } catch {
          /* treat as signed out */
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Dismiss on outside click and on Escape, the two ways people expect to close a menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    await logout();
    resolved.current = false;
    setMe(null);
    router.push('/');
    router.refresh();
  }

  // Render nothing until the session is known, so the bar doesn't flip from
  // "Sign in" to an avatar a moment after load.
  if (!ready) return <div aria-hidden className="h-8 w-16" />;

  if (!me) {
    return (
      <LinkButton href="/login" size="sm">
        Sign in
      </LinkButton>
    );
  }

  const name = me.profile?.displayName ?? 'Account';
  const initial = name.trim().charAt(0).toUpperCase() || 'A';

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex h-8 w-8 items-center justify-center rounded-pill bg-accent text-caption font-semibold text-accent-fg transition-opacity duration-200 hover:opacity-90"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-50 w-56 animate-fade-in overflow-hidden rounded-lg bg-surface py-1.5 shadow-lift"
        >
          <div className="px-4 py-2">
            <p className="truncate text-caption font-medium">{name}</p>
            {me.profile?.handle && (
              <p className="truncate text-micro text-faint">@{me.profile.handle}</p>
            )}
          </div>
          <div className="my-1.5 border-t border-hairline" />
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-caption text-muted transition-colors duration-150 hover:bg-sunken hover:text-text"
            >
              {l.label}
            </Link>
          ))}
          <div className="my-1.5 border-t border-hairline" />
          <button
            role="menuitem"
            onClick={signOut}
            className="block w-full px-4 py-2 text-left text-caption text-danger transition-colors duration-150 hover:bg-sunken"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
