'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import type { Listing } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';

export default function WishlistPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState<Listing[]>([]);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          setItems(await apiAuthed<Listing[]>('/wishlist'));
        } catch {
          /* ignore */
        }
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <Link href="/login?next=/wishlist" className="text-brand underline">
        Sign in to view your wishlist
      </Link>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Your wishlist</h1>
      {items.length === 0 ? (
        <p className="text-muted">
          Nothing saved yet.{' '}
          <Link href="/search" className="text-brand underline">
            Explore listings.
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
