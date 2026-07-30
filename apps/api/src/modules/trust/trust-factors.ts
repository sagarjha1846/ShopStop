/** One line of the explainable trust breakdown shown to the public. */
export interface TrustContribution {
  key: string;
  label: string;
  points: number;
}

/**
 * Public-facing labels for the constructive factors. Penalty factors (`fraud`,
 * `lostDisputes`) are internal risk signals: publishing them would both leak how the
 * fraud engine scores and expose a moderation outcome the seller can't answer, so
 * they are deliberately absent from this map and therefore from every response.
 */
const PUBLIC_FACTOR_LABELS: Record<string, string> = {
  emailVerified: 'Email verified',
  phoneVerified: 'Phone verified',
  identityVerified: 'Government ID verified',
  businessVerified: 'Business verified',
  completedSales: 'Completed sales',
  rating: 'Buyer ratings',
  tenure: 'Account longevity',
};

/**
 * Turn the stored factor JSON into a public, positive-only, sorted breakdown.
 * Shared by the profile and listing endpoints so one definition governs what a
 * buyer is allowed to see about how a seller's score was built.
 */
export function publicTrustFactors(factors: unknown): TrustContribution[] {
  if (!factors || typeof factors !== 'object') return [];
  const out: TrustContribution[] = [];
  for (const [key, label] of Object.entries(PUBLIC_FACTOR_LABELS)) {
    const points = (factors as Record<string, unknown>)[key];
    if (typeof points === 'number' && points > 0) out.push({ key, label, points });
  }
  return out.sort((a, b) => b.points - a.points);
}
