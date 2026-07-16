import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { NOTIFY_QUEUE, type EmailJob } from './notify.producer';

/** In-process worker for the notify queue. Handles transactional email sends
 *  (and can grow to push/SMS). Failures retry with backoff (see the producer). */
@Processor(NOTIFY_QUEUE)
export class NotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'email': {
        const { to, subject, html } = job.data as EmailJob;
        await this.mail.send(to, subject, html);
        this.logger.debug(`Sent email "${subject}" to ${to}`);
        break;
      }
      default:
        this.logger.warn(`Unknown notify job: ${job.name}`);
    }
  }
}
