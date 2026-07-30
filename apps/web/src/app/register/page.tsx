'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth-client';
import { Button, Card, Field, inputClass } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email, password, displayName || undefined);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-2 text-center text-title font-semibold">Create your account</h1>
      <p className="mb-6 text-center text-caption text-muted">
        Verifying your email and phone raises your trust score, which is what buyers see.
      </p>
      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Placeholders are kept alongside labels because the browser smoke test
              selects these inputs by placeholder. */}
          <Field label="Display name" hint="Optional. This is the name buyers see.">
            <input
              placeholder="Display name (optional)"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              required
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <input
              type="password"
              required
              minLength={10}
              placeholder="Password (min 10 chars)"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="mt-5 text-center text-caption text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-link hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
