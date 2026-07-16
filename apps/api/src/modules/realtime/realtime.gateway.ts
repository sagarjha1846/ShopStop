import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/services/token.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Realtime delivery for chat + notifications (docs/09 #7). REST stays the source of
 * truth; this only pushes events. JWT-authenticated at handshake. A Redis adapter
 * lets it scale horizontally (docs/17) — multiple API instances fan out via pub/sub.
 *
 * Rooms:
 *   user:<id>     personal room (notifications, inbox updates)
 *   thread:<id>   a conversation (joined after participant check)
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    // Token from handshake auth or Authorization header.
    const raw =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace('Bearer ', '');
    if (!raw) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.tokens.verifyAccess(raw);
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  /** Client asks to join a conversation; server verifies participation first (ABAC). */
  @SubscribeMessage('thread:join')
  async onThreadJoin(client: Socket, threadId: string): Promise<{ ok: boolean }> {
    const userId = client.data.userId as string | undefined;
    if (!userId || typeof threadId !== 'string') return { ok: false };
    const part = await this.prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId } },
    });
    if (!part) return { ok: false };
    await client.join(`thread:${threadId}`);
    return { ok: true };
  }

  @SubscribeMessage('thread:leave')
  async onThreadLeave(client: Socket, threadId: string): Promise<void> {
    if (typeof threadId === 'string') await client.leave(`thread:${threadId}`);
  }

  @SubscribeMessage('typing')
  onTyping(client: Socket, threadId: string): void {
    const userId = client.data.userId as string | undefined;
    if (userId && typeof threadId === 'string') {
      client.to(`thread:${threadId}`).emit('typing', { threadId, userId });
    }
  }

  // ---- server-side emit helpers (called by services) ----

  emitNewMessage(threadId: string, participantIds: string[], message: unknown): void {
    if (!this.server) return;
    this.server.to(`thread:${threadId}`).emit('message:new', message);
    // Also nudge each participant's inbox room so thread lists reorder live.
    for (const uid of participantIds) {
      this.server.to(`user:${uid}`).emit('thread:updated', { threadId });
    }
  }

  emitNotification(userId: string, notification: unknown): void {
    this.server?.to(`user:${userId}`).emit('notification:new', notification);
  }
}
