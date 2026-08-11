import {
  NOTIFICATION_CATEGORIES,
  categoryForType,
  findCategory,
  resolveChannels,
} from './notification-categories';

describe('categoryForType', () => {
  it('maps event-type prefixes to categories', () => {
    expect(categoryForType('order.update')).toBe('orders');
    expect(categoryForType('message.new')).toBe('messages');
    expect(categoryForType('offer.received')).toBe('offers');
    expect(categoryForType('trust.badge')).toBe('trust');
  });

  it('folds related prefixes into one category', () => {
    expect(categoryForType('dispute.opened')).toBe('trust');
    expect(categoryForType('report.resolved')).toBe('trust');
    expect(categoryForType('account.password_changed')).toBe('security');
  });

  it('returns null for unknown types', () => {
    expect(categoryForType('sometwhing.else')).toBeNull();
    expect(categoryForType('')).toBeNull();
  });
});

describe('resolveChannels', () => {
  const orders = findCategory('orders')!;
  const security = findCategory('security')!;
  const marketing = findCategory('marketing')!;

  it('falls back to category defaults when the user has no override', () => {
    expect(resolveChannels(orders, null)).toEqual({ inApp: true, email: true });
    expect(resolveChannels(marketing, null)).toEqual({ inApp: false, email: false });
  });

  it('applies a stored override', () => {
    expect(resolveChannels(orders, { inApp: false, email: false })).toEqual({
      inApp: false,
      email: false,
    });
  });

  it('applies a partial override per channel', () => {
    expect(resolveChannels(orders, { email: false })).toEqual({ inApp: true, email: false });
    expect(resolveChannels(marketing, { email: true })).toEqual({ inApp: false, email: true });
  });

  it('ignores overrides on locked categories — security notices cannot be silenced', () => {
    expect(resolveChannels(security, { inApp: false, email: false })).toEqual({
      inApp: true,
      email: true,
    });
  });

  it('delivers unknown categories in-app but never emails them', () => {
    expect(resolveChannels(undefined)).toEqual({ inApp: true, email: false });
  });
});

describe('the taxonomy itself', () => {
  it('has unique keys', () => {
    const keys = NOTIFICATION_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps marketing opt-in on both channels (DPDP/GDPR)', () => {
    expect(findCategory('marketing')!.defaults).toEqual({ inApp: false, email: false });
  });
});
