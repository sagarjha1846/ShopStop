import { Global, Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { TrustScoreService } from './trust-score.service';

// Global so any module can trigger a trust recompute without import wiring.
@Global()
@Module({
  providers: [RiskService, TrustScoreService],
  exports: [RiskService, TrustScoreService],
})
export class TrustModule {}
