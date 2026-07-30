'use client';

import { useEffect, useState } from 'react';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import type { Listing } from '@/lib/api';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState, LinkButton, Loading, PageHeader, SignInPrompt } from '@/components/ui';

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

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/wishlist" what="your saved items" />;

  return (
    <div className="py-4">
      <PageHeader
        title="Saved items"
        description={items.length === 1 ? '1 item' : `${items.length} items`}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Save a listing and it will wait here for you."
          action={<LinkButton href="/search">Browse listings</LinkButton>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
