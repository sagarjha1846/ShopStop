import { Injectable } from '@nestjs/common';
import { DisputeStatus, OrderStatus, type Dispute, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { RefundsService } from '../payments/refunds.service';

// A dispute can be opened once the money is committed and until the deal is closed.
const DISPUTABLE: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.RETURNED,
];

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refunds: RefundsService,
  ) {}

  async open(userId: string, orderId: string, reason: string, evidence?: string[]): Promise<Dispute> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { dispute: true } });
    if (!order) throw AppError.notFound('Order');
    if (order.buyerId !== userId && order.sellerId !== userId) throw AppError.forbidden();
    if (!DISPUTABLE.includes(order.status)) throw AppError.illegalState('This order cannot be disputed');
    if (order.dispute) throw AppError.conflict('A dispute already exists for this order');

    const dispute = await this.prisma.dispute.create({
      data: {
        orderId,
        openedById: userId,
        reason,
        status: DisputeStatus.OPEN,
        evidence: (evidence ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: userId,
      action: 'dispute.opened',
      targetType: 'ORDER',
      targetId: orderId,
      meta: { disputeId: dispute.id, reason },
    });
    return dispute;
  }

  async get(userId: string, disputeId: string, isAdmin: boolean): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: true },
    });
    if (!dispute) throw AppError.notFound('Dispute');
    if (!isAdmin && dispute.order.buyerId !== userId && dispute.order.sellerId !== userId) {
      throw AppError.forbidden();
    }
    return dispute;
  }

  async listOpen(): Promise<Dispute[]> {
    return this.prisma.dispute.findMany({
      where: { status: { in: [DisputeStatus.OPEN, DisputeStatus.EVIDENCE] } },
      orderBy: { createdAt: 'asc' },
      include: { order: { select: { id: true, totalMinor: true, currency: true, buyerId: true, sellerId: true } } },
      take: 50,
    });
  }

  /** Admin resolution. Refund/release affect the order; recorded to the audit chain. */
  async resolve(
    adminId: string,
    disputeId: string,
    status: DisputeStatus,
    resolution: string,
    ip?: string,
    refundAmountMinor?: number,
  ): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: { select: { totalMinor: true } } },
    });
    if (!dispute) throw AppError.notFound('Dispute');
    if (dispute.status.startsWith('RESOLVED') || dispute.status === DisputeStatus.REJECTED) {
      throw AppError.illegalState('Dispute is already resolved');
    }

    // A partial resolution with no amount used to close the dispute and move no
    // money at all: the buyer got nothing while the record said they were repaid.
    if (status === DisputeStatus.RESOLVED_PARTIAL) {
      if (refundAmountMinor === undefined) {
        throw AppError.validation('A partial refund needs refundAmountMinor');
      }
      if (refundAmountMinor <= 0 || refundAmountMinor >= dispute.order.totalMinor) {
        throw AppError.validation(
          `refundAmountMinor must be between 1 and ${dispute.order.totalMinor - 1}; use RESOLVED_REFUND for the full amount`,
        );
      }
    } else if (refundAmountMinor !== undefined) {
      // An amount on a release or a full refund is a mistake, not a nuance.
      throw AppError.validation(`refundAmountMinor does not apply to ${status}`);
    }

    // Compare-and-set: two admins resolving the same dispute at once would both
    // pass the read above and both book a refund.
    const claimed = await this.prisma.dispute.updateMany({
      where: { id: disputeId, status: { in: [DisputeStatus.OPEN, DisputeStatus.EVIDENCE] } },
      data: { status, resolution, resolvedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.illegalState('Dispute is already resolved');

    if (status === DisputeStatus.RESOLVED_REFUND || status === DisputeStatus.RESOLVED_PARTIAL) {
      try {
        await this.bookRefund(dispute.orderId, refundAmountMinor, disputeId);
      } catch (err) {
        // The gateway refused, so no money moved. Hand the dispute back rather
        // than leaving it closed as refunded — an admin has to be able to retry,
        // and a resolution that claims a refund nobody received is the bug this
        // whole path exists to prevent.
        await this.prisma.dispute.updateMany({
          where: { id: disputeId, status },
          data: { status: dispute.status, resolution: dispute.resolution, resolvedAt: dispute.resolvedAt },
        });
        throw err;
      }
    }

    await this.audit.record({
      actorId: adminId,
      action: `dispute.${status.toLowerCase()}`,
      targetType: 'DISPUTE',
      targetId: disputeId,
      ip,
      meta: { resolution, ...(refundAmountMinor !== undefined ? { refundAmountMinor } : {}) },
    });
    return this.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } });
  }

  /**
   * Refund the buyer through the shared refund path, then move the order if the
   * whole sale is being unwound.
   *
   * A full refund closes the order as REFUNDED. A partial one leaves it where it
   * was — the buyer keeps the item and the seller keeps the rest — and the
   * commission comes back in proportion, which the refund path handles.
   */
  private async bookRefund(orderId: string, amountMinor: number | undefined, disputeId: string): Promise<void> {
    const outcome = await this.refunds.refundOrder(orderId, amountMinor, disputeId);
    if (!outcome) throw AppError.illegalState('This order has nothing left to refund');

    if (amountMinor === undefined) {
      await this.prisma.order.updateMany({
        where: { id: orderId, status: { not: OrderStatus.REFUNDED } },
        data: { status: OrderStatus.REFUNDED },
      });
    }
  }
}
