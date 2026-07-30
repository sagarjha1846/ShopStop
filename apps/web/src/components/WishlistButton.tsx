'use client';

import { useEffect, useState } from 'react';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { Button } from './ui';
import { HeartIcon } from './icons';

/** Heart toggle on the listing page. No-op prompt to sign in if unauthenticated. */
export function WishlistButton({ listingId }: { listingId: string }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [wishlisted, setWishlisted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const { wishlisted: w } = await apiAuthed<{ wishlisted: boolean }>(
            `/wishlist/${listingId}`,
          );
          setWishlisted(w);
        } catch {
          /* ignore */
        }
      }
    })();
  }, [listingId]);

  async function toggle() {
    if (authed === false) {
      window.location.href = `/login?next=/l/${listingId}`;
      return;
    }
    setBusy(true);
    try {
      if (wishlisted) {
        await apiAuthed(`/wishlist/${listingId}`, { method: 'DELETE' });
        setWishlisted(false);
      } else {
        await apiAuthed('/wishlist', { method: 'POST', body: { listingId } });
        setWishlisted(true);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={toggle} disabled={busy} aria-pressed={wishlisted} variant="ghost">
      <HeartIcon filled={wishlisted} className={wishlisted ? 'text-danger' : ''} />
      {wishlisted ? 'Saved' : 'Save'}
    </Button>
  );
}
