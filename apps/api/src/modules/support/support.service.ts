import { Injectable } from '@nestjs/common';
import { TicketStatus, type Prisma, type SupportTicket } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';

interface TicketMessage {
  authorId: string;
  staff: boolean;
  body: string;
  at: string;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, subject: string, body: string): Promise<SupportTicket> {
    const first: TicketMessage = { authorId: userId, staff: false, body: body.trim(), at: new Date().toISOString() };
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: subject.trim().slice(0, 160),
        status: TicketStatus.OPEN,
        messages: [first] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  listOwn(userId: string): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  listOpen(): Promise<SupportTicket[]> {
    return this.prisma.supportTicket.findMany({
      where: { status: { in: [TicketStatus.OPEN, TicketStatus.PENDING] } },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'asc' }],
      take: 100,
    });
  }

  async get(userId: string, id: string, isStaff: boolean): Promise<SupportTicket> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw AppError.notFound('Ticket');
    if (!isStaff && ticket.userId !== userId) throw AppError.forbidden();
    return ticket;
  }

  /** Append a reply. Staff replies set PENDING (awaiting user); user replies set OPEN. */
  async reply(userId: string, id: string, body: string, isStaff: boolean): Promise<SupportTicket> {
    const ticket = await this.get(userId, id, isStaff);
    if (ticket.status === TicketStatus.CLOSED) throw AppError.illegalState('Ticket is closed');
    const messages = [
      ...(Array.isArray(ticket.messages) ? (ticket.messages as unknown as TicketMessage[]) : []),
      { authorId: userId, staff: isStaff, body: body.trim(), at: new Date().toISOString() },
    ];
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        messages: messages as unknown as Prisma.InputJsonValue,
        status: isStaff ? TicketStatus.PENDING : TicketStatus.OPEN,
      },
    });
  }

  async close(userId: string, id: string, isStaff: boolean): Promise<SupportTicket> {
    await this.get(userId, id, isStaff);
    return this.prisma.supportTicket.update({ where: { id }, data: { status: TicketStatus.CLOSED } });
  }
}
