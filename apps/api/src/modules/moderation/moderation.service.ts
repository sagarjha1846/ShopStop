import { Injectable } from '@nestjs/common';
import {
  ModerationDecision,
  ReportStatus,
  ReportSubject,
  UserStatus,
  ListingStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import type { CreateReportDto, ModerationActionDto } from './dto/moderation.dto';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto): Promise<{ id: string; status: ReportStatus }> {
    const data = {
      reporterId,
      subjectType: dto.subjectType,
      reason: dto.reason,
      details: dto.details,
      listingId: dto.subjectType === ReportSubject.LISTING ? dto.subjectId : undefined,
      reportedUserId: dto.subjectType === ReportSubject.USER ? dto.subjectId : undefined,
      messageId: dto.subjectType === ReportSubject.MESSAGE ? dto.subjectId : undefined,
    };
    const report = await this.prisma.report.create({ data });
    return { id: report.id, status: report.status };
  }

  /**
   * Prioritized moderation/fraud queue (docs/10). Merges open reports and open
   * fraud events, highest-risk first. Fraud events carry an explicit risk score;
   * reports are ranked by age as a simple proxy.
   */
  async getQueue(): Promise<{ fraud: unknown[]; reports: unknown[] }> {
    const [fraud, reports] = await Promise.all([
      this.prisma.fraudEvent.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ riskScore: 'desc' }, { createdAt: 'asc' }],
        take: 50,
        include: { user: { select: { id: true, email: true, status: true } } },
      }),
      this.prisma.report.findMany({
        where: { status: ReportStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ]);
    return { fraud, reports };
  }

  /** Apply a moderation decision to a subject; audit-logged (hash chain). */
  async act(
    moderatorId: string,
    subjectType: ReportSubject,
    subjectId: string,
    dto: ModerationActionDto,
    ip?: string,
  ): Promise<{ ok: true }> {
    switch (subjectType) {
      case ReportSubject.LISTING:
        await this.actOnListing(subjectId, dto.decision);
        break;
      case ReportSubject.USER:
        await this.actOnUser(subjectId, dto.decision);
        break;
      case ReportSubject.MESSAGE:
        await this.actOnMessage(subjectId, dto.decision);
        break;
    }

    // Resolve any open reports for this subject.
    await this.resolveReportsFor(subjectType, subjectId, dto.decision);

    // Record the moderation action + tamper-evident audit entry.
    await this.prisma.moderationAction.create({
      data: { moderatorId, subjectType, subjectId, decision: dto.decision, reason: dto.reason },
    });
    await this.audit.record({
      actorId: moderatorId,
      action: `moderation.${dto.decision.toLowerCase()}`,
      targetType: subjectType,
      targetId: subjectId,
      ip,
      meta: { reason: dto.reason },
    });
    return { ok: true };
  }

  async resolveFraudEvent(
    moderatorId: string,
    fraudEventId: string,
    status: 'CONFIRMED' | 'FALSE_POSITIVE',
    ip?: string,
  ): Promise<{ ok: true }> {
    const event = await this.prisma.fraudEvent.findUnique({ where: { id: fraudEventId } });
    if (!event) throw AppError.notFound('Fraud event');
    await this.prisma.fraudEvent.update({ where: { id: fraudEventId }, data: { status } });
    await this.audit.record({
      actorId: moderatorId,
      action: `fraud.${status.toLowerCase()}`,
      targetType: 'FRAUD_EVENT',
      targetId: fraudEventId,
      ip,
    });
    return { ok: true };
  }

  // ---- subject-specific actions ----

  private async actOnListing(listingId: string, decision: ModerationDecision): Promise<void> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw AppError.notFound('Listing');
    if (decision === ModerationDecision.APPROVE) {
      await this.prisma.listing.update({
        where: { id: listingId },
        data: { status: ListingStatus.ACTIVE, publishedAt: listing.publishedAt ?? new Date() },
      });
    } else if (decision === ModerationDecision.REJECT) {
      await this.prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.REJECTED } });
    } else if (decision === ModerationDecision.BAN || decision === ModerationDecision.RESTRICT) {
      await this.prisma.listing.update({ where: { id: listingId }, data: { status: ListingStatus.REMOVED } });
    }
    // DISMISS: no state change.
  }

  private async actOnUser(userId: string, decision: ModerationDecision): Promise<void> {
    const map: Partial<Record<ModerationDecision, UserStatus>> = {
      [ModerationDecision.SUSPEND]: UserStatus.SUSPENDED,
      [ModerationDecision.BAN]: UserStatus.BANNED,
      [ModerationDecision.RESTRICT]: UserStatus.RESTRICTED,
      [ModerationDecision.APPROVE]: UserStatus.ACTIVE,
    };
    const status = map[decision];
    if (!status) return; // DISMISS / REJECT are no-ops for users
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User');
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === UserStatus.BANNED || status === UserStatus.SUSPENDED) {
      // Revoke sessions and pull their live listings.
      await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.listing.updateMany({
        where: { sellerId: userId, status: { in: [ListingStatus.ACTIVE, ListingStatus.PENDING_REVIEW] } },
        data: { status: ListingStatus.REMOVED },
      });
    }
  }

  private async actOnMessage(messageId: string, decision: ModerationDecision): Promise<void> {
    if (decision === ModerationDecision.REJECT || decision === ModerationDecision.BAN) {
      await this.prisma.message.updateMany({ where: { id: messageId }, data: { deletedAt: new Date() } });
    }
  }

  private async resolveReportsFor(
    subjectType: ReportSubject,
    subjectId: string,
    decision: ModerationDecision,
  ): Promise<void> {
    const status = decision === ModerationDecision.DISMISS ? ReportStatus.DISMISSED : ReportStatus.ACTIONED;
    const where =
      subjectType === ReportSubject.LISTING
        ? { listingId: subjectId }
        : subjectType === ReportSubject.USER
          ? { reportedUserId: subjectId }
          : { messageId: subjectId };
    await this.prisma.report.updateMany({ where: { ...where, status: ReportStatus.OPEN }, data: { status } });
  }
}
