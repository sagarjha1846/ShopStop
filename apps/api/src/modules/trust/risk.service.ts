import { Injectable, Logger } from '@nestjs/common';
import { FraudSignal, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RiskBand = 'low' | 'medium' | 'high';

export interface RiskSignalHit {
  signal: FraudSignal;
  weight: number;
  detail: string;
}

export interface RiskVerdict {
  score: number; // 0..100
  band: RiskBand;
  signals: RiskSignalHit[];
}

export interface ListingRiskInput {
  sellerId: string;
  title: string;
  description: string;
  priceMinor: number;
  sellerTrustScore: number;
  sellerVerified: boolean; // email or phone verified
}

/**
 * Rules-first risk engine (docs/10). Cheap, explainable, works on day one, and
 * generates the labels a future ML model will train on. Every hit carries a weight
 * and a human-readable detail so admins see *why*. ML scoring slots in behind this
 * same interface in Phase 2+ (see docs/17).
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  // Prohibited / scam-indicator keyword dictionary (starter set; expand via config).
  private static readonly BLOCKED_KEYWORDS = [
    'weapon',
    'gun',
    'ammo',
    'drugs',
    'cocaine',
    'counterfeit',
    'fake replica',
    'stolen',
    'human organ',
    'passport for sale',
  ];
  private static readonly SCAM_PHRASES = ['wire transfer only', 'western union', 'advance fee', 'gift card only'];

  constructor(private readonly prisma: PrismaService) {}

  async assessListing(input: ListingRiskInput): Promise<RiskVerdict> {
    const signals: RiskSignalHit[] = [];
    const haystack = `${input.title} ${input.description}`.toLowerCase();

    for (const kw of RiskService.BLOCKED_KEYWORDS) {
      if (haystack.includes(kw)) {
        signals.push({ signal: FraudSignal.KEYWORD_MATCH, weight: 80, detail: `Prohibited keyword: "${kw}"` });
      }
    }
    for (const phrase of RiskService.SCAM_PHRASES) {
      if (haystack.includes(phrase)) {
        signals.push({ signal: FraudSignal.KEYWORD_MATCH, weight: 40, detail: `Scam phrase: "${phrase}"` });
      }
    }

    // Duplicate/spam: many near-identical active titles from the same seller.
    const dupCount = await this.prisma.listing.count({
      where: { sellerId: input.sellerId, title: input.title, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } },
    });
    if (dupCount >= 1) {
      signals.push({
        signal: FraudSignal.DUPLICATE_LISTING,
        weight: 35,
        detail: `${dupCount} existing listing(s) with an identical title`,
      });
    }

    // Listing velocity: burst of new listings in the last hour.
    const recentCount = await this.prisma.listing.count({
      where: { sellerId: input.sellerId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recentCount >= 10) {
      signals.push({
        signal: FraudSignal.SPAM_LISTING,
        weight: 30,
        detail: `${recentCount} listings created in the last hour`,
      });
    }

    // Unverified seller posting a high-value item → extra scrutiny.
    if (!input.sellerVerified && input.priceMinor >= 5_000_000) {
      signals.push({
        signal: FraudSignal.HIGH_RISK_TXN,
        weight: 25,
        detail: 'Unverified seller listing a high-value item',
      });
    }

    // Low trust amplifies risk.
    if (input.sellerTrustScore < 10) {
      signals.push({ signal: FraudSignal.SUSPICIOUS_LOGIN, weight: 15, detail: 'Very low seller trust score' });
    }

    const score = Math.min(
      100,
      signals.reduce((acc, s) => acc + s.weight, 0),
    );
    const band: RiskBand = score >= 70 ? 'high' : score >= 30 ? 'medium' : 'low';
    return { score, band, signals };
  }

  /** Persist a fraud event for the admin queue (docs/10). */
  async recordListingFraudEvent(
    listingId: string,
    sellerId: string,
    verdict: RiskVerdict,
  ): Promise<void> {
    if (verdict.band === 'low') return;
    const top = verdict.signals.sort((a, b) => b.weight - a.weight)[0];
    await this.prisma.fraudEvent.create({
      data: {
        userId: sellerId,
        listingId,
        signal: top?.signal ?? FraudSignal.SPAM_LISTING,
        riskScore: verdict.score,
        evidence: { signals: verdict.signals } as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Listing ${listingId} flagged (${verdict.band}, score ${verdict.score})`);
  }
}
