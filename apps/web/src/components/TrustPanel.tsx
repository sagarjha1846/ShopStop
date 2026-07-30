import Link from 'next/link';
import { Badge, Card, Divider } from './ui';
import type { TrustContribution } from '@/lib/api';

const BADGE_LABEL: Record<string, string> = {
  EMAIL: 'Email verified',
  PHONE: 'Phone verified',
  IDENTITY: 'ID verified',
  BUSINESS: 'Business',
};

/** The trust surface reused on cards, listing pages, chat headers (docs/04, docs/10). */
export function TrustBadges({ badges }: { badges: string[] }) {
  if (!badges?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
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

/**
 * The score as a figure rather than a gauge: the number at display size, and a thin
 * track showing where it sits out of 100. No dial, no gradient — the point is that
 * the value is precise and auditable, and the breakdown below says how it got there.
 */
function ScoreFigure({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="tabular text-display font-semibold leading-none">{score}</span>
        <span className="text-caption text-faint">/ 100</span>
      </div>
      <div
        className="mt-3 h-1 w-full overflow-hidden rounded-pill bg-sunken"
        role="img"
        aria-label={`Trust score ${score} out of 100`}
      >
        <div
          className="h-full rounded-pill transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: tone }}
        />
      </div>
    </div>
  );
}

/**
 * Explainable breakdown — the reason this marketplace claims to be trust-first.
 * Each factor shows its own contribution against the largest one, so the reader can
 * see at a glance which behaviour actually moved the number.
 */
export function TrustBreakdown({ factors }: { factors: TrustContribution[] }) {
  if (!factors?.length) return null;
  const max = Math.max(...factors.map((f) => Math.abs(f.points)), 1);

  return (
    <div>
      <p className="mb-3 text-micro font-medium uppercase text-faint">How this score was built</p>
      <ul className="space-y-2.5">
        {factors.map((f) => {
          const negative = f.points < 0;
          return (
            <li key={f.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption">{f.label}</span>
                <span
                  className={`tabular text-caption font-medium ${negative ? 'text-danger' : 'text-success'}`}
                >
                  {negative ? '' : '+'}
                  {f.points}
                </span>
              </div>
              <div className="mt-1 h-px w-full bg-sunken">
                <div
                  className="h-px"
                  style={{
                    width: `${(Math.abs(f.points) / max) * 100}%`,
                    background: negative ? 'var(--danger)' : 'var(--success)',
                  }}
                />
              </div>
            </li>
          );
        })}
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
  const stats: Array<[string, string]> = [
    ['Rating', ratingCount ? `${ratingAvg.toFixed(1)} (${ratingCount})` : 'No reviews yet'],
    ['Completed sales', String(completedSales)],
    ['Responds in', responseMins ? `~${responseMins} min` : 'Not enough data'],
    ['Member since', String(new Date(memberSince).getFullYear())],
  ];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-footnote font-semibold">{displayName}</p>
          <Link
            href={`/u/${handle}`}
            className="text-caption text-link transition-opacity duration-200 hover:opacity-70"
          >
            @{handle}
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <ScoreFigure score={trustScore} />
      </div>

      {badges.length > 0 && (
        <div className="mt-4">
          <TrustBadges badges={badges} />
        </div>
      )}

      <Divider className="my-5" />

      <dl className="space-y-2">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="tabular text-caption">{value}</dd>
          </div>
        ))}
      </dl>

      {trustFactors && trustFactors.length > 0 && (
        <>
          <Divider className="my-5" />
          <TrustBreakdown factors={trustFactors} />
        </>
      )}
    </Card>
  );
}
