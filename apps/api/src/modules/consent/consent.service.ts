import { Injectable } from '@nestjs/common';
import type { Consent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Bump when the policy text changes so we can prove which version a user consented to.
export const POLICY_VERSION = '2026-01';
export const CONSENT_PURPOSES = ['cookies_analytics', 'marketing', 'data_processing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Append-only consent record (DPDP/GDPR — auditable history of grants/withdrawals). */
  async record(userId: string, purpose: ConsentPurpose, granted: boolean): Promise<Consent> {
    return this.prisma.consent.create({
      data: { userId, purpose, granted, version: POLICY_VERSION },
    });
  }

  /** Latest decision per purpose (the effective consent state). */
  async current(userId: string): Promise<Record<string, boolean>> {
    const rows = await this.prisma.consent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const state: Record<string, boolean> = {};
    for (const r of rows) {
      if (!(r.purpose in state)) state[r.purpose] = r.granted; // first seen = latest
    }
    return state;
  }
}
