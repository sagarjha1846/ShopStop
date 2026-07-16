import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export const MEDIA_SCAN_QUEUE = 'media-scan';

export interface MediaScanJob {
  mediaId: string;
  storageKey: string;
}

/** Enqueues uploaded media for async virus/NSFW/illegal-image scanning (docs/09 #8). */
@Injectable()
export class MediaScanProducer {
  constructor(@InjectQueue(MEDIA_SCAN_QUEUE) private readonly queue: Queue) {}

  async enqueue(job: MediaScanJob): Promise<void> {
    await this.queue.add('scan', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
