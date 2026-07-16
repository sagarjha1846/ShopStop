import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MediaScanStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MEDIA_SCAN_QUEUE, type MediaScanJob } from './media-scan.producer';

/**
 * Media scan worker (docs/09 #8). In production this calls a malware scanner +
 * NSFW/illegal-image classifier and re-encodes to strip EXIF. Here it's a stub
 * that CLEANs media and REJECTs anything whose key is marked (so the flagged path
 * is exercisable); the pipeline — enqueue on attach, set scanStatus, hide flagged
 * media — is real.
 */
@Processor(MEDIA_SCAN_QUEUE)
export class MediaScanProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaScanProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { mediaId, storageKey } = job.data as MediaScanJob;
    const flagged = /flagme|nsfw|malware/i.test(storageKey);
    const status = flagged ? MediaScanStatus.REJECTED : MediaScanStatus.CLEAN;
    await this.prisma.media.updateMany({ where: { id: mediaId }, data: { scanStatus: status } });
    if (flagged) this.logger.warn(`Media ${mediaId} REJECTED by scan`);
  }
}
