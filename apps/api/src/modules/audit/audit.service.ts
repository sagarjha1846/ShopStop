import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

/**
 * Tamper-evident audit log (docs/11). Each row stores
 *   hash = sha256(prevHash + canonical(row))
 * so silent tampering/deletion is detectable by re-walking the chain. Append-only.
 * Writes are serialized to keep the chain consistent under concurrency.
 */
@Injectable()
export class AuditService {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    // Serialize appends so prevHash is always the true latest row.
    this.writeChain = this.writeChain.then(() => this.append(entry)).catch(() => undefined);
    await this.writeChain;
  }

  private async append(entry: AuditEntry): Promise<void> {
    const prev = await this.prisma.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? 'GENESIS';
    const canonical = JSON.stringify({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? {},
    });
    const hash = createHash('sha256').update(prevHash + canonical).digest('hex');

    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ip: entry.ip,
        meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
        prevHash,
        hash,
      },
    });
  }

  /** Verify the integrity of the audit chain (admin/ops + tests). */
  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string }> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    let prevHash = 'GENESIS';
    for (const row of rows) {
      const canonical = JSON.stringify({
        actorId: row.actorId ?? null,
        action: row.action,
        targetType: row.targetType ?? null,
        targetId: row.targetId ?? null,
        meta: row.meta ?? {},
      });
      const expected = createHash('sha256').update(prevHash + canonical).digest('hex');
      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { valid: false, brokenAt: row.id };
      }
      prevHash = row.hash;
    }
    return { valid: true };
  }
}
