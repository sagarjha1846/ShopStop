'use client';

import { useEffect, useState } from 'react';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { Badge, Button, Loading, PageHeader, SignInPrompt, inputClass } from '@/components/ui';

interface Address {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}
const EMPTY = { label: '', line1: '', line2: '', city: '', state: '', postalCode: '', isDefault: false };

export default function AddressesPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState<Address[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setItems(await apiAuthed<Address[]>('/addresses'));
  }
  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) await load().catch(() => undefined);
      setReady(true);
    })();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiAuthed('/addresses', { method: 'POST', body: form });
      setForm({ ...EMPTY });
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to add address');
    }
  }
  async function remove(id: string) {
    await apiAuthed(`/addresses/${id}`, { method: 'DELETE' });
    await load();
  }
  async function makeDefault(a: Address) {
    await apiAuthed(`/addresses/${a.id}`, { method: 'PATCH', body: { ...a, isDefault: true } });
    await load();
  }

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/addresses" what="your addresses" />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Addresses" description="Where your orders get delivered." />

      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex items-start justify-between rounded-lg bg-surface shadow-card p-3">
            <div className="text-footnote">
              <div className="flex items-center gap-2 font-medium">
                {a.label || 'Address'} {a.isDefault && <Badge tone="brand">Default</Badge>}
              </div>
              <div className="text-muted">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
              </div>
            </div>
            <div className="flex gap-2">
              {!a.isDefault && (
                <Button variant="ghost" className="px-2 py-1 text-caption" onClick={() => makeDefault(a)}>
                  Set default
                </Button>
              )}
              <Button variant="outline" className="px-2 py-1 text-caption" onClick={() => remove(a.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {items.length === 0 && <p className="text-muted">No saved addresses yet.</p>}
      </ul>

      <form onSubmit={add} className="space-y-2 rounded-lg bg-surface shadow-card p-4">
        <h2 className="font-semibold">Add an address</h2>
        <input placeholder="Label (Home, Work)" value={form.label} onChange={set('label')} className={inputClass} />
        <input required placeholder="Address line 1" value={form.line1} onChange={set('line1')} className={inputClass} />
        <input placeholder="Address line 2" value={form.line2} onChange={set('line2')} className={inputClass} />
        <div className="grid grid-cols-3 gap-2">
          <input required placeholder="City" value={form.city} onChange={set('city')} className={inputClass} />
          <input required placeholder="State" value={form.state} onChange={set('state')} className={inputClass} />
          <input required placeholder="PIN" value={form.postalCode} onChange={set('postalCode')} className={inputClass} />
        </div>
        {err && <p className="text-footnote text-danger">{err}</p>}
        <Button type="submit">Add address</Button>
      </form>
    </div>
  );
}
