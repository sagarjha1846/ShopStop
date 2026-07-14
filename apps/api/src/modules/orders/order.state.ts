import { OrderStatus } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';

export type OrderActor = 'buyer' | 'seller' | 'system';
export type OrderAction =
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'pack'
  | 'ship'
  | 'deliver'
  | 'return'
  | 'refund';

interface TransitionRule {
  from: OrderStatus[];
  to: OrderStatus;
  actors: OrderActor[];
}

/**
 * Order lifecycle (docs/09 #4). Enforced server-side: an action is only legal from
 * the right state AND by the right party. `system` = payment webhook / admin.
 */
const TRANSITIONS: Record<OrderAction, TransitionRule> = {
  accept: { from: [OrderStatus.PENDING], to: OrderStatus.ACCEPTED, actors: ['seller', 'system'] },
  reject: { from: [OrderStatus.PENDING], to: OrderStatus.REJECTED, actors: ['seller'] },
  cancel: { from: [OrderStatus.PENDING, OrderStatus.ACCEPTED], to: OrderStatus.CANCELLED, actors: ['buyer'] },
  pack: { from: [OrderStatus.ACCEPTED], to: OrderStatus.PACKED, actors: ['seller'] },
  ship: { from: [OrderStatus.PACKED], to: OrderStatus.SHIPPED, actors: ['seller'] },
  deliver: { from: [OrderStatus.SHIPPED], to: OrderStatus.DELIVERED, actors: ['buyer', 'system'] },
  return: { from: [OrderStatus.DELIVERED], to: OrderStatus.RETURNED, actors: ['buyer'] },
  refund: {
    from: [OrderStatus.RETURNED, OrderStatus.CANCELLED, OrderStatus.ACCEPTED],
    to: OrderStatus.REFUNDED,
    actors: ['seller', 'system'],
  },
};

export function resolveTransition(action: OrderAction, from: OrderStatus, actor: OrderActor): OrderStatus {
  const rule = TRANSITIONS[action];
  if (!rule) throw AppError.validation(`Unknown order action "${action}"`);
  if (!rule.actors.includes(actor)) {
    throw AppError.forbidden(`A ${actor} cannot ${action} this order`);
  }
  if (!rule.from.includes(from)) {
    throw AppError.illegalState(`Cannot ${action} an order in ${from} state`);
  }
  return rule.to;
}

export const ORDER_ACTIONS: OrderAction[] = Object.keys(TRANSITIONS) as OrderAction[];
