import { Badge } from './ui';
import type { TrustContribution } from '@/lib/api';

const BADGE_LABEL: Record<string, string> = {
  EMAIL: '✓ Email',
  PHONE: '✓ Phone',
  IDENTITY: '✓ ID verified',
  BUSINESS: '✓ Business',
};

/** The trust surface reused on cards, listing pages, chat headers (docs/04, docs/10). */
export function TrustBadges({ badges }: { badges: string[] }) {
  if (!badges?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Badge key={b} tone="verified">
          {BADGE_LABEL[b] ?? b}
        </Badge>
      ))}
    </div>
  );
}

export function TrustScore({ score }: { score: number }) {
  const tone = score >= 70 ? 'success' : score >= 40 ? 'warn' : 'danger';
  return <Badge tone={tone}>Trust {score}</Badge>;
}

/** Explainable breakdown: shows *why* a seller earned their trust score (docs/10). */
export function TrustBreakdown({ factors }: { factors: TrustContribution[] }) {
  if (!factors?.length) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Why this score</div>
      <ul className="space-y-1.5 text-sm">
        {factors.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-2">
            <span>{f.label}</span>
            <span className="font-medium text-success">+{f.points}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SellerTrustPanel({
  displayName,
  handle,
  trustScore,
  trustFactors,
  badges,
  ratingAvg,
  ratingCount,
  completedSales,
  responseMins,
  memberSince,
}: {
  displayName: string;
  handle: string;
  trustScore: number;
  trustFactors?: TrustContribution[];
  badges: string[];
  ratingAvg: number;
  ratingCount: number;
  completedSales: number;
  responseMins: number | null;
  memberSince: string;
}) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">{displayName}</div>
          <div className="text-sm text-muted">@{handle}</div>
        </div>
        <TrustScore score={trustScore} />
      </div>
      <div className="mt-3">
        <TrustBadges badges={badges} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted">Rating</dt>
          <dd>{ratingCount ? `★ ${ratingAvg.toFixed(1)} (${ratingCount})` : 'No reviews yet'}</dd>
        </div>
        <div>
          <dt className="text-muted">Completed sales</dt>
          <dd>{completedSales}</dd>
        </div>
        <div>
          <dt className="text-muted">Responds in</dt>
          <dd>{responseMins ? `~${responseMins}m` : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Member since</dt>
          <dd>{new Date(memberSince).getFullYear()}</dd>
        </div>
      </dl>
      {trustFactors && <TrustBreakdown factors={trustFactors} />}
    </div>
  );
}
