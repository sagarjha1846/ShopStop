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
  ): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw AppError.notFound('Dispute');
    if (dispute.status.startsWith('RESOLVED') || dispute.status === DisputeStatus.REJECTED) {
      throw AppError.illegalState('Dispute is already resolved');
    }

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status, resolution, resolvedAt: new Date() },
    });

    if (status === DisputeStatus.RESOLVED_REFUND) await this.bookRefund(dispute.orderId);
    await this.audit.record({
      actorId: adminId,
      action: `dispute.${status.toLowerCase()}`,
      targetType: 'DISPUTE',
      targetId: disputeId,
      ip,
      meta: { resolution },
    });
    return updated;
  }

  /**
   * Move a refunded order to REFUNDED and record the money coming back out.
   *
   * Two ledger rows, not one. The REFUND row is the outflow to the buyer. The
   * negative FEE row is a contra entry that backs out the commission: the
   * platform does not keep its cut of a sale that was refunded, and without the
   * reversal `SUM(FEE)` would report revenue the business never actually earned.
   *
   * Compare-and-set on the status so a second resolution attempt cannot book the
   * refund twice.
   */
  private async bookRefund(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { totalMinor: true, feeMinor: true, currency: true, sellerId: true },
    });
    if (!order) return;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: { not: OrderStatus.REFUNDED } },
        data: { status: OrderStatus.REFUNDED },
      });
      if (claimed.count === 0) return;

      await tx.transaction.create({
        data: {
          orderId,
          type: TransactionType.REFUND,
          amountMinor: order.totalMinor,
          currency: order.currency,
          meta: { basis: 'order.refund' },
        },
      });

      if (order.feeMinor > 0) {
        await tx.transaction.create({
          data: {
            orderId,
            userId: order.sellerId,
            type: TransactionType.FEE,
            amountMinor: -order.feeMinor,
            currency: order.currency,
            meta: { basis: 'order.commission.reversal' },
          },
        });
      }
    });
  }
}
