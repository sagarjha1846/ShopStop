'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { Button, Loading, PageHeader, SignInPrompt, inputClass } from '@/components/ui';

interface Me {
  email: string;
  mfaEnabled: boolean;
  profile?: { handle: string; displayName: string; bio: string | null; locationText: string | null } | null;
}

export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [locationText, setLocationText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const m = await apiAuthed<Me>('/me/profile');
          setMe(m);
          setDisplayName(m.profile?.displayName ?? '');
          setBio(m.profile?.bio ?? '');
          setLocationText(m.profile?.locationText ?? '');
        } catch {
          /* ignore */
        }
      }
      setReady(true);
    })();
  }, []);

  async function exportData() {
    try {
      const data = await apiAuthed<unknown>('/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shopstop-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus('Could not export data.');
    }
  }

  async function deleteAccount() {
    if (!confirm('Permanently delete your account? This anonymizes your data and cannot be undone.')) return;
    try {
      await apiAuthed('/me', { method: 'DELETE' });
      window.location.href = '/';
    } catch {
      setStatus('Could not delete account.');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await apiAuthed('/me/profile', { method: 'PATCH', body: { displayName, bio, locationText } });
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/settings" what="your settings" />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Settings" description="Your profile, privacy and account data." />

      <form onSubmit={save} className="space-y-3 rounded-lg bg-surface shadow-card p-4">
        <h2 className="font-semibold">Profile</h2>
        <div className="text-footnote text-muted">
          {me?.email} · @{me?.profile?.handle}
        </div>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className={inputClass} />
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" rows={3} className={inputClass} />
        <input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Location" className={inputClass} />
        {status && <p className="text-footnote text-accent">{status}</p>}
        <Button type="submit">Save profile</Button>
      </form>

      <div className="rounded-lg bg-surface shadow-card p-4">
        <h2 className="font-semibold">Security</h2>
        <p className="mt-1 text-footnote text-muted">
          Two-factor authentication (TOTP) is {me?.mfaEnabled ? 'enabled' : 'available'}. Manage via the
          API (`/auth/mfa/enroll`) — a guided setup UI is on the roadmap.
        </p>
      </div>

      <div className="rounded-lg bg-surface shadow-card p-4">
        <h2 className="font-semibold">Privacy &amp; data</h2>
        <p className="mt-1 text-footnote text-muted">
          Download everything we hold about you, or permanently delete your account (DPDP/GDPR).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportData}>
            Download my data
          </Button>
          {/* Destructive actions read as text, never as a filled red button — the
              weight should match the risk, not shout for the click. */}
          <Button variant="danger" onClick={deleteAccount}>
            Delete my account
          </Button>
        </div>
      </div>

      <div className="flex gap-4 text-footnote">
        <Link href="/addresses" className="text-link hover:underline">
          Addresses
        </Link>
        <Link href="/wishlist" className="text-link hover:underline">
          Wishlist
        </Link>
        <Link href="/dashboard" className="text-link hover:underline">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
