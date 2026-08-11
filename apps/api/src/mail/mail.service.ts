import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../config/config.service';

/**
 * Transactional email. Local dev → MailHog (SMTP :1025). Prod → SES/Resend via SMTP.
 * Every send now runs on the `notify` BullMQ worker, never on the request path.
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

  /**
   * Sends, or throws. The only caller is the notify worker, which is configured
   * for 3 attempts with exponential backoff — so a transient SMTP failure has to
   * propagate for that retry to happen. Swallowing it here (as this used to,
   * back when sends were on the request path) silently dropped every email and
   * still logged the job as complete.
   */
  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.config.get('EMAIL_FROM'), to, subject, html });
    } catch (err) {
      this.logger.error(`Failed to send "${subject}" to ${to}: ${String(err)}`);
      throw err;
    }
  }

  /** Render the verification email (subject + html) without sending — the worker sends it. */
  renderEmailVerification(to: string, token: string): { to: string; subject: string; html: string } {
    const url = `${this.config.get('WEB_BASE_URL')}/auth/verify?token=${token}`;
    return {
      to,
      subject: 'Verify your ShopStop email',
      html: `<p>Welcome to ShopStop. Confirm your email:</p><p><a href="${url}">Verify email</a></p>`,
    };
  }

  /**
   * Render the email copy of an in-app notification. Deep-links to the order or
   * thread when the event carries one, and always points at the preference
   * centre — an unsubscribe path is a legal requirement, not a courtesy.
   */
  renderNotification(
    to: string,
    n: { title: string; body?: string; data?: Record<string, unknown> },
  ): { to: string; subject: string; html: string } {
    const web = this.config.get('WEB_BASE_URL');
    // Encoded, not merely type-checked: these ids land inside an href, and a
    // caller passing through user input must not be able to escape the attribute.
    const orderId = typeof n.data?.orderId === 'string' ? encodeURIComponent(n.data.orderId) : null;
    const threadId = typeof n.data?.threadId === 'string' ? n.data.threadId : null;
    const link = orderId ? `${web}/orders/${orderId}` : threadId ? `${web}/messages` : `${web}/notifications`;

    return {
      to,
      subject: n.title,
      html: [
        `<p><strong>${escapeHtml(n.title)}</strong></p>`,
        n.body ? `<p>${escapeHtml(n.body)}</p>` : '',
        `<p><a href="${link}">View on ShopStop</a></p>`,
        `<hr /><p style="font-size:12px;color:#666">Don't want these emails? `,
        `<a href="${web}/settings">Manage notification preferences</a>.</p>`,
      ].join(''),
    };
  }
}

/**
 * Notification titles and bodies embed user-controlled text (chat previews,
 * order notes), so they must never be interpolated into email HTML raw.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
