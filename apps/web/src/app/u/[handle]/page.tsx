import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type PublicProfile } from '@/lib/api';
import { SellerTrustPanel } from '@/components/TrustPanel';
import { timeAgo } from '@/lib/format';
import { Card, EmptyState } from '@/components/ui';

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
    <div className="grid gap-8 py-4 lg:grid-cols-[360px_1fr] lg:gap-12">
      <SellerTrustPanel
        displayName={profile.displayName}
        handle={profile.handle}
        trustScore={profile.trustScore}
        trustFactors={profile.trustFactors}
        badges={profile.badges}
        ratingAvg={profile.ratingAvg}
        ratingCount={profile.ratingCount}
        completedSales={profile.completedSales}
        responseMins={profile.responseMins}
        memberSince={profile.memberSince}
      />
      <div>
        <h2 className="mb-4 text-headline font-semibold">
          Reviews{reviews.length > 0 && <span className="ml-2 text-caption font-normal text-faint">{reviews.length}</span>}
        </h2>
        {reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            body={`Reviews appear here once ${profile.displayName} completes a sale.`}
          />
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <Card key={r.id} as="li" className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span aria-label={`${r.rating} out of 5`} className="text-footnote">
                    <span className="text-warn">{'\u2605'.repeat(r.rating)}</span>
                    <span className="text-faint">{'\u2605'.repeat(5 - r.rating)}</span>
                  </span>
                  <span className="text-caption text-faint">{timeAgo(r.createdAt)}</span>
                </div>
                {r.body && <p className="mt-2 text-footnote">{r.body}</p>}
                <p className="mt-2 text-caption text-faint">
                  @{r.author?.profile?.handle ?? 'user'}
                </p>
              </Card>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
