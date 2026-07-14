import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../config/config.module';

/**
 * Transactional email. Local dev → MailHog (SMTP :1025). Prod → SES/Resend via SMTP.
 * In production this send is enqueued on the `notify` BullMQ queue (Phase 4);
 * kept synchronous here for the auth bootstrap slice.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: AppConfigService) {
    this.transporter = createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      secure: false,
      auth: config.get('SMTP_USER')
        ? { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') }
        : undefined,
    });
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.config.get('EMAIL_FROM'), to, subject, html });
    } catch (err) {
      // Never fail the request because email failed; log for ops/retry.
      this.logger.error(`Failed to send "${subject}" to ${to}: ${String(err)}`);
    }
  }

  sendEmailVerification(to: string, token: string): Promise<void> {
    const url = `${this.config.get('WEB_BASE_URL')}/auth/verify?token=${token}`;
    return this.send(
      to,
      'Verify your ShopStop email',
      `<p>Welcome to ShopStop. Confirm your email:</p><p><a href="${url}">Verify email</a></p>`,
    );
  }
}
