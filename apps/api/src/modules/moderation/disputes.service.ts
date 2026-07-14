import { Injectable } from '@nestjs/common';
import { DisputeStatus, OrderStatus, type Dispute, type Prisma } from '@prisma/client';
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

    // A refund resolution moves the order to REFUNDED (ledger/refund automation: Phase 2).
    if (status === DisputeStatus.RESOLVED_REFUND) {
      await this.prisma.order.updateMany({
        where: { id: dispute.orderId, status: { not: OrderStatus.REFUNDED } },
        data: { status: OrderStatus.REFUNDED },
      });
    }
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
}
