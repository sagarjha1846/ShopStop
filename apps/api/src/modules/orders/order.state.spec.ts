import { OrderStatus } from '@prisma/client';
import { resolveTransition } from './order.state';
import { AppError } from '../../common/errors/app-error';

describe('order state machine', () => {
  it('allows seller to accept a pending order', () => {
    expect(resolveTransition('accept', OrderStatus.PENDING, 'seller')).toBe(OrderStatus.ACCEPTED);
  });

  it('allows system (payment webhook) to accept a pending order', () => {
    expect(resolveTransition('accept', OrderStatus.PENDING, 'system')).toBe(OrderStatus.ACCEPTED);
  });

  it('forbids buyer from accepting an order', () => {
    expect(() => resolveTransition('accept', OrderStatus.PENDING, 'buyer')).toThrow(AppError);
  });

  it('forbids seller from shipping before packing', () => {
    expect(() => resolveTransition('ship', OrderStatus.ACCEPTED, 'seller')).toThrow(/Cannot ship/);
  });

  it('walks the happy path pending -> accepted -> packed -> shipped -> delivered', () => {
    expect(resolveTransition('accept', OrderStatus.PENDING, 'seller')).toBe(OrderStatus.ACCEPTED);
    expect(resolveTransition('pack', OrderStatus.ACCEPTED, 'seller')).toBe(OrderStatus.PACKED);
    expect(resolveTransition('ship', OrderStatus.PACKED, 'seller')).toBe(OrderStatus.SHIPPED);
    expect(resolveTransition('deliver', OrderStatus.SHIPPED, 'buyer')).toBe(OrderStatus.DELIVERED);
  });

  it('only the buyer can confirm delivery or open a return', () => {
    expect(resolveTransition('deliver', OrderStatus.SHIPPED, 'buyer')).toBe(OrderStatus.DELIVERED);
    expect(() => resolveTransition('return', OrderStatus.DELIVERED, 'seller')).toThrow(AppError);
    expect(resolveTransition('return', OrderStatus.DELIVERED, 'buyer')).toBe(OrderStatus.RETURNED);
  });

  it('rejects an illegal transition (deliver from pending)', () => {
    expect(() => resolveTransition('deliver', OrderStatus.PENDING, 'buyer')).toThrow(/Cannot deliver/);
  });

  it('cannot cancel an already-shipped order', () => {
    expect(() => resolveTransition('cancel', OrderStatus.SHIPPED, 'buyer')).toThrow(AppError);
  });
});
