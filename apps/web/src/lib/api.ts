// Thin API client. On the server (SSR) we call the backend directly; in the
// browser we hit the same-origin /api proxy (see next.config rewrites) so auth
// cookies stay first-party. Access tokens are held in memory by the auth store.

const SERVER_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

export function apiBase(): string {
  // On the server there is no window; use the backend origin.
  return typeof window === 'undefined' ? `${SERVER_BASE}/api/v1` : '/api/v1';
}

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  // For SSR reads: cache/revalidate behavior.
  revalidate?: number;
  cache?: RequestCache;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${apiBase()}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.revalidate !== undefined ? { next: { revalidate: opts.revalidate } } : {}),
  });

  if (!res.ok) {
    let body: ApiErrorShape | null = null;
    try {
      body = (await res.json()) as ApiErrorShape;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'ERROR',
      body?.error?.message ?? res.statusText,
      body?.error?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- shared types (mirror the backend contract) ----

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon?: string | null;
  attributeSchema: { fields?: AttrField[] };
  children: Category[];
}
export interface AttrField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  unit?: string;
}

export interface ListingMedia {
  id: string;
  storageKey: string;
  type: string;
}
export interface Listing {
  id: string;
  slug: string;
  title: string;
  description?: string;
  priceMinor: number;
  currency: string;
  negotiable?: boolean;
  condition?: string | null;
  status: string;
  attributes?: Record<string, unknown>;
  media?: ListingMedia[];
  locationText?: string | null;
  sellerId: string;
  seller?: {
    profile?: { handle: string; displayName: string; avatarUrl?: string | null } | null;
    trustScore?: { score: number } | null;
    emailVerifiedAt?: string | null;
    phoneVerifiedAt?: string | null;
  };
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TrustContribution {
  key: string;
  label: string;
  points: number;
}

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  memberSince: string;
  trustScore: number;
  trustFactors: TrustContribution[];
  badges: string[];
  ratingAvg: number;
  ratingCount: number;
  completedSales: number;
  responseMins: number | null;
  followerCount: number;
}
