import { Injectable } from '@nestjs/common';
import { ListingStatus, type ListingQuestion } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppError } from '../../../common/errors/app-error';
import { RiskService } from '../../trust/risk.service';
import { NotificationsService } from '../../notifications/notifications.service';

const MAX_LEN = 500;

/**
 * Public questions on a listing.
 *
 * The point is liquidity, not another inbox: asking publicly is a lower-commitment
 * first touch than opening a chat, and one answer serves every later buyer. The
 * funnel counts a question as listing engagement for exactly that reason.
 */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Visible Q&A for a listing. Public — no auth, so it never leaks asker emails. */
  async list(listingId: string): Promise<unknown[]> {
    const rows = await this.prisma.listingQuestion.findMany({
      where: { listingId, hiddenAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { asker: { select: { profile: { select: { handle: true, displayName: true } } } } },
    });
    return rows.map((q) => ({
      id: q.id,
      body: q.body,
      answerBody: q.answerBody,
      answeredAt: q.answeredAt,
      createdAt: q.createdAt,
      askedBy: q.asker.profile?.handle ?? null,
      askedByName: q.asker.profile?.displayName ?? null,
    }));
  }

  async ask(askerId: string, listingId: string, body: string): Promise<ListingQuestion> {
    const text = body.trim();
    if (text.length < 5) throw AppError.validation('Question is too short');
    if (text.length > MAX_LEN) throw AppError.validation(`Question must be ${MAX_LEN} characters or fewer`);

    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, deletedAt: null } });
    if (!listing) throw AppError.notFound('Listing');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw AppError.illegalState('Questions are only open on an active listing');
    }
    if (listing.sellerId === askerId) throw AppError.validation('You cannot ask a question on your own listing');

    // Screened against the same dictionary as listings: this text is published
    // publicly, so it is exactly as much of a moderation surface as a listing is.
    const hit = this.risk.matchBlockedKeyword(text);
    if (hit) throw AppError.validation('That question cannot be posted');

    const question = await this.prisma.listingQuestion.create({
      data: { listingId, askerId, body: text },
    });

    await this.notifications
      .notify({
        userId: listing.sellerId,
        type: 'question.asked',
        title: 'New question on your listing',
        body: text.slice(0, 120),
        data: { listingId, questionId: question.id },
      })
      .catch(() => undefined);

    return question;
  }

  /** Only the listing's seller may answer — an answer carries their authority. */
  async answer(sellerId: string, questionId: string, body: string): Promise<ListingQuestion> {
    const text = body.trim();
    if (text.length < 1) throw AppError.validation('Answer is empty');
    if (text.length > MAX_LEN) throw AppError.validation(`Answer must be ${MAX_LEN} characters or fewer`);

    const question = await this.prisma.listingQuestion.findUnique({
      where: { id: questionId },
      include: { listing: { select: { sellerId: true, id: true } } },
    });
    if (!question || question.hiddenAt) throw AppError.notFound('Question');
    if (question.listing.sellerId !== sellerId) {
      throw AppError.forbidden('Only the seller can answer questions on their listing');
    }
    if (question.answeredAt) throw AppError.conflict('This question is already answered');

    const hit = this.risk.matchBlockedKeyword(text);
    if (hit) throw AppError.validation('That answer cannot be posted');

    const updated = await this.prisma.listingQuestion.update({
      where: { id: questionId },
      data: { answerBody: text, answeredById: sellerId, answeredAt: new Date() },
    });

    await this.notifications
      .notify({
        userId: question.askerId,
        type: 'question.answered',
        title: 'Your question was answered',
        body: text.slice(0, 120),
        data: { listingId: question.listing.id, questionId },
      })
      .catch(() => undefined);

    return updated;
  }

  /** Moderation take-down: hide without destroying the record (docs/10 audit trail). */
  async hide(questionId: string): Promise<void> {
    await this.prisma.listingQuestion.updateMany({
      where: { id: questionId, hiddenAt: null },
      data: { hiddenAt: new Date() },
    });
  }
}
