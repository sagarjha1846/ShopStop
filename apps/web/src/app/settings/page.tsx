'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { Button } from '@/components/ui';

interface Me {
  email: string;
  mfaEnabled: boolean;
  profile?: { handle: string; displayName: string; bio: string | null; locationText: string | null } | null;
}

interface NotificationPreference {
  category: string;
  label: string;
  description: string;
  locked: boolean;
  inApp: boolean;
  email: boolean;
}

export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [locationText, setLocationText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [prefStatus, setPrefStatus] = useState<string | null>(null);

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
        try {
          setPrefs(await apiAuthed<NotificationPreference[]>('/me/notification-preferences'));
        } catch {
          /* ignore */
        }
      }
      setReady(true);
    })();
  }, []);

  /** Optimistic toggle: flip locally, persist, roll back if the API rejects it. */
  async function togglePref(category: string, channel: 'inApp' | 'email', value: boolean) {
    const previous = prefs;
    const next = prefs.map((p) => (p.category === category ? { ...p, [channel]: value } : p));
    setPrefs(next);
    setPrefStatus(null);
    const updated = next.find((p) => p.category === category)!;
    try {
      setPrefs(
        await apiAuthed<NotificationPreference[]>('/me/notification-preferences', {
          method: 'PATCH',
          body: { preferences: [{ category, inApp: updated.inApp, email: updated.email }] },
        }),
      );
      setPrefStatus('Preferences saved.');
    } catch (err) {
      setPrefs(previous);
      setPrefStatus(err instanceof Error ? err.message : 'Could not save preferences');
    }
  }

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

  if (!ready) return <div className="text-muted">Loading…</div>;
  if (!authed)
    return (
      <Link href="/login?next=/settings" className="text-brand underline">
        Sign in to manage settings
      </Link>
    );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <form onSubmit={save} className="space-y-3 rounded-lg border bg-surface p-4">
        <h2 className="font-semibold">Profile</h2>
        <div className="text-sm text-muted">
          {me?.email} · @{me?.profile?.handle}
        </div>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className="w-full rounded-md border bg-bg px-3 py-2" />
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" rows={3} className="w-full rounded-md border bg-bg px-3 py-2" />
        <input value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Location" className="w-full rounded-md border bg-bg px-3 py-2" />
        {status && <p className="text-sm text-accent">{status}</p>}
        <Button type="submit">Save profile</Button>
      </form>

      <div className="rounded-lg border bg-surface p-4">
        <h2 className="font-semibold">Security</h2>
        <p className="mt-1 text-sm text-muted">
          Two-factor authentication (TOTP) is {me?.mfaEnabled ? 'enabled' : 'available'}. Manage via the
          API (`/auth/mfa/enroll`) — a guided setup UI is on the roadmap.
        </p>
      </div>

      <div className="rounded-lg border bg-surface p-4">
        <h2 className="font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted">
          Choose how each kind of update reaches you. Account &amp; security notices are always on.
        </p>

        <div className="mt-3 divide-y">
          <div className="hidden gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted sm:grid sm:grid-cols-[1fr_5rem_5rem]">
            <span>Category</span>
            <span className="text-center">In-app</span>
            <span className="text-center">Email</span>
          </div>

          {prefs.map((p) => (
            <div key={p.category} className="grid gap-1 py-3 sm:grid-cols-[1fr_5rem_5rem] sm:items-center sm:gap-2">
              <div>
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted">{p.description}</div>
              </div>
              {(['inApp', 'email'] as const).map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-sm sm:justify-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand disabled:opacity-50"
                    checked={p[channel]}
                    disabled={p.locked}
                    aria-label={`${channel === 'inApp' ? 'In-app' : 'Email'} notifications for ${p.label}`}
                    onChange={(e) => togglePref(p.category, channel, e.target.checked)}
                  />
                  <span className="text-muted sm:hidden">{channel === 'inApp' ? 'In-app' : 'Email'}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        {prefs.length === 0 && <p className="mt-2 text-sm text-muted">Could not load preferences.</p>}
        {prefStatus && <p className="mt-2 text-sm text-accent">{prefStatus}</p>}
      </div>

      <div className="rounded-lg border bg-surface p-4">
        <h2 className="font-semibold">Privacy &amp; data</h2>
        <p className="mt-1 text-sm text-muted">
          Download everything we hold about you, or permanently delete your account (DPDP/GDPR).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportData}>
            Download my data
          </Button>
          <Button variant="outline" className="text-danger" onClick={deleteAccount}>
            Delete my account
          </Button>
        </div>
      </div>

      <div className="flex gap-4 text-sm">
        <Link href="/addresses" className="text-brand underline">
          Addresses
        </Link>
        <Link href="/wishlist" className="text-brand underline">
          Wishlist
        </Link>
        <Link href="/dashboard" className="text-brand underline">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
