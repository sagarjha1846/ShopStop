'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, getAccessToken } from '@/lib/auth-client';
import { Button } from './ui';

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
    // A contained card pinned to the bottom corner, so it never lies across the page
    // content the way a full-width bar does.
    <div
      role="dialog"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-4 bottom-4 z-50 animate-rise-in sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-sm"
    >
      <div className="rounded-lg bg-surface p-5 shadow-lift">
        <p id="cookie-consent-title" className="text-footnote font-semibold">
          Cookies on ShopStop
        </p>
        <p className="mt-1.5 text-caption text-muted">
          Strictly necessary cookies keep the site working. Analytics cookies are only set if
          you allow them.{' '}
          <Link href="/legal/cookies" className="text-link hover:underline">
            How we use cookies
          </Link>
        </p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => choose(true)}>
            Accept all
          </Button>
          <Button size="sm" variant="secondary" onClick={() => choose(false)}>
            Necessary only
          </Button>
        </div>
      </div>
    </div>
  );
}
