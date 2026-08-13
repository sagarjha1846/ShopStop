import { Injectable } from '@nestjs/common';
import { DisputeStatus, OrderStatus, TransactionType, type Dispute, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';

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

    if (status === DisputeStatus.RESOLVED_REFUND) await this.bookRefund(dispute.orderId);
    if (status === DisputeStatus.RESOLVED_PARTIAL) await this.bookRefund(dispute.orderId, refundAmountMinor);

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
   * Record money going back to the buyer.
   *
   * Two ledger rows, not one. The REFUND row is the outflow to the buyer. The
   * negative FEE row is a contra entry that backs out the commission: the
   * platform does not keep its cut of a sale that was refunded, and without the
   * reversal `SUM(FEE)` would report revenue the business never actually earned.
   *
   * `amountMinor` omitted means a full refund, which also moves the order to
   * REFUNDED. A partial refund leaves the order where it is — the buyer keeps the
   * item and the seller keeps the rest — and reverses the commission in the same
   * proportion, so the platform and the seller share the cost of the goodwill
   * rather than the seller carrying all of it.
   *
   * Compare-and-set on the status so a second resolution attempt cannot book a
   * full refund twice; partial refunds are guarded by the dispute claim in
   * `resolve()`, which is what stops the same dispute being resolved twice.
   */
  private async bookRefund(orderId: string, amountMinor?: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { totalMinor: true, feeMinor: true, currency: true, sellerId: true },
    });
    if (!order) return;

    const partial = amountMinor !== undefined;
    const refundMinor = amountMinor ?? order.totalMinor;
    // Proportional, and rounded once: the platform gives back the same share of
    // its commission as the buyer is getting back of their payment.
    const feeReversalMinor = partial
      ? Math.round((order.feeMinor * refundMinor) / order.totalMinor)
      : order.feeMinor;

    await this.prisma.$transaction(async (tx) => {
      if (!partial) {
        const claimed = await tx.order.updateMany({
          where: { id: orderId, status: { not: OrderStatus.REFUNDED } },
          data: { status: OrderStatus.REFUNDED },
        });
        if (claimed.count === 0) return;
      }

      await tx.transaction.create({
        data: {
          orderId,
          type: TransactionType.REFUND,
          amountMinor: refundMinor,
          currency: order.currency,
          meta: { basis: partial ? 'order.refund.partial' : 'order.refund' },
        },
      });

      if (feeReversalMinor > 0) {
        await tx.transaction.create({
          data: {
            orderId,
            userId: order.sellerId,
            type: TransactionType.FEE,
            amountMinor: -feeReversalMinor,
            currency: order.currency,
            meta: { basis: 'order.commission.reversal' },
          },
        });
      }
    });
  }
}
