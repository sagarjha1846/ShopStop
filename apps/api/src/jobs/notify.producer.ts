import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export const NOTIFY_QUEUE = 'notify';

export interface EmailJob {
  to: string;
  subject: string;
  html: string;
}

/**
 * Enqueues async work so it stays off the request path (docs/07). Jobs are
 * idempotent-friendly and retried with backoff. In MVP the worker runs in-process
 * (see JobsModule); it can move to a separate container without code changes.
 */
@Injectable()
export class NotifyProducer {
  constructor(@InjectQueue(NOTIFY_QUEUE) private readonly queue: Queue) {}

  async enqueueEmail(job: EmailJob): Promise<void> {
    await this.queue.add('email', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
