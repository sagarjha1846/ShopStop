'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, getAccessToken } from '@/lib/auth-client';

const KEY = 'cookie-consent';

/**
 * Cookie consent banner (DPDP/GDPR). The choice is stored locally so it works for
 * anonymous visitors; if the user is signed in it's also recorded server-side via
 * the consent API (auditable history).
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(KEY)) setShow(true);
  }, []);

  async function choose(granted: boolean) {
    localStorage.setItem(KEY, granted ? 'accepted' : 'rejected');
    setShow(false);
    if (getAccessToken()) {
      await apiAuthed('/consents', { method: 'POST', body: { purpose: 'cookies_analytics', granted } }).catch(
        () => undefined,
      );
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-surface/95 p-4 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          We use strictly necessary cookies to run ShopStop, and optional analytics cookies only with
          your consent. See our{' '}
          <Link href="/legal/cookies" className="text-brand underline">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => choose(false)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-border">
            Reject optional
          </button>
          <button onClick={() => choose(true)} className="rounded-md bg-brand px-3 py-1.5 text-sm text-brand-fg hover:opacity-90">
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
