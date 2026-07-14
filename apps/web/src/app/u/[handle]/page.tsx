import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type PublicProfile } from '@/lib/api';
import { SellerTrustPanel } from '@/components/TrustPanel';
import { timeAgo } from '@/lib/format';

interface Review {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  author?: { profile?: { handle: string; displayName: string } | null };
}

async function getProfile(handle: string): Promise<PublicProfile | null> {
  try {
    return await api<PublicProfile>(`/users/${handle}`, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const p = await getProfile(handle).catch(() => null);
  return { title: p ? `${p.displayName} (@${p.handle})` : 'Profile' };
}

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await getProfile(handle);
  if (!profile) notFound();

  const reviews = await api<Review[]>(`/reviews/user/${profile.id}`, { cache: 'no-store' }).catch(() => []);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <SellerTrustPanel
        displayName={profile.displayName}
        handle={profile.handle}
        trustScore={profile.trustScore}
        badges={profile.badges}
        ratingAvg={profile.ratingAvg}
        ratingCount={profile.ratingCount}
        completedSales={profile.completedSales}
        responseMins={profile.responseMins}
        memberSince={profile.memberSince}
      />
      <div>
        <h2 className="mb-3 text-lg font-semibold">Reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-muted">No reviews yet.</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-lg border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {'★'.repeat(r.rating)}
                    <span className="text-border">{'★'.repeat(5 - r.rating)}</span>
                  </span>
                  <span className="text-xs text-muted">{timeAgo(r.createdAt)}</span>
                </div>
                {r.body && <p className="mt-1 text-sm">{r.body}</p>}
                <p className="mt-1 text-xs text-muted">
                  by @{r.author?.profile?.handle ?? 'user'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
