'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAccessToken, refresh } from '@/lib/auth-client';
import type { AttrField, Category } from '@/lib/api';
import { Button, Card, Field, inputClass, Loading, SignInPrompt } from '@/components/ui';

async function authedFetch(path: string, init?: RequestInit) {
  const token = getAccessToken();
  return fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
}

function flatten(cats: Category[], depth = 0): { id: string; label: string; fields: AttrField[] }[] {
  const out: { id: string; label: string; fields: AttrField[] }[] = [];
  for (const c of cats) {
    out.push({ id: c.id, label: `${'— '.repeat(depth)}${c.name}`, fields: c.attributeSchema?.fields ?? [] });
    if (c.children?.length) out.push(...flatten(c.children, depth + 1));
  }
  return out;
}

export default function SellPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      const res = await fetch('/api/v1/categories');
      if (res.ok) setCategories(await res.json());
      setReady(true);
    })();
  }, []);

  const flat = useMemo(() => flatten(categories), [categories]);
  const selected = flat.find((f) => f.id === categoryId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const attributes: Record<string, unknown> = {};
      for (const f of selected?.fields ?? []) {
        const v = attrs[f.key];
        if (v !== undefined && v !== '') attributes[f.key] = f.type === 'number' ? Number(v) : v;
      }
      const res = await authedFetch('/listings', {
        method: 'POST',
        body: JSON.stringify({
          categoryId,
          title,
          description,
          priceMinor: Math.round(Number(price) * 100),
          attributes,
          publish: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Failed to create listing');
      router.push(`/l/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <Loading />;
  if (!authed) return <SignInPrompt next="/sell" what="the seller tools" />;

  return (
    <div className="mx-auto max-w-xl py-4">
      <h1 className="mb-1 text-title font-semibold">Create a listing</h1>
      <p className="mb-6 text-caption text-muted">
        Publishing runs automated risk checks. High-risk listings are held for review before
        they go live.
      </p>

      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Category">
            <select
              required
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setAttrs({});
              }}
              className={inputClass}
            >
              <option value="">Select a category…</option>
              {flat.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title" hint="What you'd call it if a friend asked.">
            <input
              required
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Description" hint="Condition, what's included, anything a buyer should know.">
            <textarea
              required
              placeholder="Describe your item…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={inputClass}
            />
          </Field>

          <Field label="Price">
            <input
              required
              type="number"
              min={0}
              step="0.01"
              placeholder="Price (₹)"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${inputClass} tabular`}
            />
          </Field>

          {/* Category-specific attributes rendered from the schema (data-driven). */}
          {selected?.fields.map((f) => (
            <Field key={f.key} label={f.required ? `${f.label} (required)` : f.label}>
              {f.type === 'select' ? (
                <select
                  value={attrs[f.key] ?? ''}
                  onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={attrs[f.key] ?? ''}
                  onChange={(e) => setAttrs((a) => ({ ...a, [f.key]: e.target.value }))}
                  className={inputClass}
                />
              )}
            </Field>
          ))}

          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Publishing…' : 'Publish listing'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
