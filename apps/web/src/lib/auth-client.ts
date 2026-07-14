'use client';

// Minimal client auth: access token kept in memory; refresh token lives in the
// httpOnly cookie set by the backend (never touched by JS). On 401 the caller can
// call refresh(). This is the browser-side counterpart to docs/08's auth flow.

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}
export function setAccessToken(t: string | null): void {
  accessToken = t;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message ?? 'Request failed';
    throw new Error(msg);
  }
  return data as T;
}

export async function login(email: string, password: string, mfaCode?: string) {
  const data = await post<{ accessToken: string; user: unknown; mfaRequired?: boolean }>('/auth/login', {
    email,
    password,
    ...(mfaCode ? { mfaCode } : {}),
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function register(email: string, password: string, displayName?: string) {
  const data = await post<{ accessToken: string; user: unknown }>('/auth/register', {
    email,
    password,
    ...(displayName ? { displayName } : {}),
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function refresh(): Promise<boolean> {
  try {
    const data = await post<{ accessToken: string }>('/auth/refresh', {});
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticated fetch with a single silent-refresh retry on 401. Returns parsed
 * JSON; throws Error(message) on failure. Ensures a token exists first (via the
 * refresh cookie) so a page reload keeps the session.
 */
export async function apiAuthed<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  if (!getAccessToken()) await refresh();
  const call = () =>
    fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'include',
    });

  let res = await call();
  if (res.status === 401 && (await refresh())) res = await call();

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? 'Request failed');
  return (res.status === 204 ? undefined : data) as T;
}
