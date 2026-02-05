import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

interface EmailJob {
  emailLogId: string;
  coopId: string;
  to: string;
  subject: string;
  templateKey: string;
  templateData: Record<string, unknown>;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

@Processor('email')
export class EmailProcessor {
  constructor(private prisma: PrismaService) {}

  @Process('send')
  async handleSend(job: Job<EmailJob>) {
    const { emailLogId, coopId, to, subject, templateKey, templateData, attachments } = job.data;

    try {
      // Get coop email configuration
      const coop = await this.prisma.coop.findUnique({
        where: { id: coopId },
      });

      if (!coop) {
        throw new Error('Coop not found');
      }

      // Get email content from template
      const html = this.renderTemplate(templateKey, templateData, coop.name);

      // Determine which email provider to use
      if (coop.emailProvider === 'graph' && coop.graphClientId) {
        await this.sendViaGraph(coop, to, subject, html, attachments);
      } else {
        await this.sendViaSmtp(coop, to, subject, html, attachments);
      }

      // Update email log
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });
    } catch (error) {
      // Update email log with error
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  private async sendViaSmtp(
    coop: { smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPass: string | null; smtpFrom: string | null; name: string },
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    // Use coop SMTP settings or fall back to environment
    const host = coop.smtpHost || process.env.SMTP_HOST;
    const port = coop.smtpPort || parseInt(process.env.SMTP_PORT || '587', 10);
    const user = coop.smtpUser || process.env.SMTP_USER;
    const pass = coop.smtpPass || process.env.SMTP_PASS;
    const from = coop.smtpFrom || process.env.SMTP_FROM || `${coop.name} <noreply@opencoop.be>`;

    if (!host) {
      throw new Error('SMTP not configured');
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      attachments,
    });
  }

  private async sendViaGraph(
    coop: { graphClientId: string | null; graphClientSecret: string | null; graphTenantId: string | null; graphFromEmail: string | null },
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    // Microsoft Graph API implementation
    // This would require @azure/identity and @microsoft/microsoft-graph-client
    // For now, we'll throw an error if Graph is configured but not implemented
    throw new Error('Microsoft Graph email not yet implemented');

    // TODO: Implement Graph API email sending
    // const credential = new ClientSecretCredential(
    //   coop.graphTenantId,
    //   coop.graphClientId,
    //   coop.graphClientSecret
    // );
    // const client = Client.initWithMiddleware({ authProvider: ... });
    // await client.api(`/users/${coop.graphFromEmail}/sendMail`).post({ message: { ... } });
  }

  private renderTemplate(
    templateKey: string,
    data: Record<string, unknown>,
    coopName: string,
  ): string {
    // Simple template rendering - in production, use a proper template engine
    const templates: Record<string, (data: Record<string, unknown>, coopName: string) => string> = {
      welcome: (d, cn) => `
        <h1>Welcome to ${cn}!</h1>
        <p>Dear ${d.shareholderName},</p>
        <p>Thank you for becoming a shareholder of ${cn}.</p>
        <p>You can log in to your dashboard to view your shares and documents.</p>
      `,
      'share-purchase': (d, cn) => `
        <h1>Share Purchase Confirmation</h1>
        <p>Dear ${d.shareholderName},</p>
        <p>We have received your share purchase request:</p>
        <ul>
          <li>Share Class: ${d.shareClassName}</li>
          <li>Quantity: ${d.quantity}</li>
          <li>Total Amount: €${(d.totalAmount as number).toFixed(2)}</li>
        </ul>
        ${d.ogmCode ? `<p>Please use the following structured communication for your bank transfer: <strong>${d.ogmCode}</strong></p>` : ''}
        <p>Thank you for investing in ${cn}!</p>
      `,
      'payment-confirmed': (d, cn) => `
        <h1>Payment Confirmed</h1>
        <p>Dear ${d.shareholderName},</p>
        <p>We have received your payment of €${(d.amount as number).toFixed(2)}.</p>
        <p>Your shares are now active. Please find your share certificate attached.</p>
        <p>Thank you for being a shareholder of ${cn}!</p>
      `,
      'dividend-statement': (d, cn) => `
        <h1>Dividend Statement ${d.year}</h1>
        <p>Dear ${d.shareholderName},</p>
        <p>Please find attached your dividend statement for ${d.year}.</p>
        <p>Net dividend amount: €${(d.netAmount as number).toFixed(2)}</p>
        <p>Thank you for being a shareholder of ${cn}!</p>
      `,
      'password-reset': (d, _cn) => `
        <h1>Password Reset Request</h1>
        <p>You have requested to reset your password.</p>
        <p>Click the link below to reset your password:</p>
        <p><a href="${d.resetUrl}">${d.resetUrl}</a></p>
        <p>If you did not request this, please ignore this email.</p>
        <p>This link will expire in 1 hour.</p>
      `,
      'magic-link': (d, _cn) => `
        <h1>Login to OpenCoop</h1>
        <p>Click the button below to log in:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.magicLinkUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Log In
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.
        </p>
      `,
    };

    const template = templates[templateKey];
    if (!template) {
      return `<p>Email template not found: ${templateKey}</p>`;
    }

    const content = template(data, coopName);

    // Wrap in basic HTML structure
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          h1 { color: #1e40af; }
        </style>
      </head>
      <body>
        ${content}
        <hr>
        <p style="color: #666; font-size: 12px;">
          This email was sent by ${coopName} via OpenCoop.
        </p>
      </body>
      </html>
    `;
  }
}
