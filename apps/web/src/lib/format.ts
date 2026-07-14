export function formatMoney(minor: number, currency = 'INR'): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString('en-IN')}`;
  }
}

export function mediaUrl(storageKey?: string | null): string | null {
  if (!storageKey) return null;
  const cdn = process.env.NEXT_PUBLIC_CDN_BASE_URL || 'http://localhost:9000/shopstop-media';
  return `${cdn}/${storageKey}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
