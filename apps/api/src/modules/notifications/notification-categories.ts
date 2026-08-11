/**
 * The notification taxonomy behind the preference center (docs/03 §7).
 *
 * `notify()` is called with an event type like `order.update`. The prefix maps to
 * a category, and the user's stored preferences for that category decide which
 * channels actually fire. Keeping the taxonomy here — rather than inside the
 * service — means the resolution rules stay pure and unit-testable.
 */

export interface ChannelSet {
  inApp: boolean;
  email: boolean;
}

export interface NotificationCategory {
  key: string;
  label: string;
  description: string;
  defaults: ChannelSet;
  /**
   * Locked categories ignore stored preferences. Account/security notices must
   * always reach the user: letting someone silence "new sign-in from a new
   * device" would hide an account takeover from the victim, so the preference
   * center deliberately cannot turn these off.
   */
  locked: boolean;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    key: 'orders',
    label: 'Orders',
    description: 'Order acceptance, packing, shipping and delivery updates.',
    defaults: { inApp: true, email: true },
    locked: false,
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'New chat messages from buyers and sellers.',
    // Email defaults off: one email per chat message trains users to mute us.
    defaults: { inApp: true, email: false },
    locked: false,
  },
  {
    key: 'offers',
    label: 'Offers',
    description: 'Offers received, accepted, countered or declined.',
    defaults: { inApp: true, email: true },
    locked: false,
  },
  {
    key: 'trust',
    label: 'Trust & safety',
    description: 'Verification badges, trust score changes, disputes and reports.',
    defaults: { inApp: true, email: true },
    locked: false,
  },
  {
    key: 'security',
    label: 'Account & security',
    description: 'Sign-ins from new devices, password and MFA changes. Always on.',
    defaults: { inApp: true, email: true },
    locked: true,
  },
  {
    key: 'marketing',
    label: 'Product news & offers',
    description: 'Occasional product updates and promotions.',
    // Opt-in, not opt-out — DPDP/GDPR treat marketing as a separate consent.
    defaults: { inApp: false, email: false },
    locked: false,
  },
];

export const CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key);

/** Event-type prefix → category key. Several prefixes can share a category. */
const CATEGORY_BY_PREFIX: Readonly<Record<string, string>> = {
  order: 'orders',
  message: 'messages',
  offer: 'offers',
  trust: 'trust',
  dispute: 'trust',
  report: 'trust',
  security: 'security',
  account: 'security',
  marketing: 'marketing',
};

export function findCategory(key: string): NotificationCategory | undefined {
  return NOTIFICATION_CATEGORIES.find((c) => c.key === key);
}

/**
 * Map an event type (`order.update`) to its category key. Returns null for types
 * we don't recognise — see resolveChannels for how those are delivered.
 */
export function categoryForType(type: string): string | null {
  const prefix = type.split('.')[0];
  return CATEGORY_BY_PREFIX[prefix] ?? null;
}

/**
 * Decide which channels fire for one notification.
 *
 * Precedence: locked category > stored override > category default. An unknown
 * category (a new event type shipped before its taxonomy entry) is delivered
 * in-app but never emailed — fail-open on the channel the user must visit to
 * see, fail-closed on the one that leaves the platform and can't be recalled.
 */
export function resolveChannels(
  category: NotificationCategory | undefined,
  override?: Partial<ChannelSet> | null,
): ChannelSet {
  if (!category) return { inApp: true, email: false };
  if (category.locked) return { ...category.defaults };
  return {
    inApp: override?.inApp ?? category.defaults.inApp,
    email: override?.email ?? category.defaults.email,
  };
}
