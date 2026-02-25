import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import {
  TokenCredentialAuthenticationProvider,
} from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

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
  private readonly logger = new Logger(EmailProcessor.name);

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

      // Check if email is enabled for this coop
      if (!coop.emailEnabled) {
        this.logger.warn(`Email disabled for coop ${coop.name} (${coopId})`);
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: {
            status: 'FAILED',
            errorMessage: 'Email disabled for this cooperative',
          },
        });
        return; // Don't retry
      }

      // Get email content from template
      const html = this.renderTemplate(templateKey, templateData, coop.name);

      // Route to the appropriate email provider
      if (coop.emailProvider === 'graph' && coop.graphClientId) {
        await this.sendViaGraph(coop, to, subject, html, attachments);
      } else if (coop.emailProvider === 'smtp' && coop.smtpHost) {
        await this.sendViaSmtp(coop, to, subject, html, attachments);
      } else {
        await this.sendViaPlatformSmtp(coop.name, to, subject, html, attachments);
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

  private async sendViaPlatformSmtp(
    coopName: string,
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || `${coopName} <noreply@opencoop.be>`;

    if (!host) {
      throw new Error('Platform SMTP not configured');
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

  private async sendViaSmtp(
    coop: { smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPass: string | null; smtpFrom: string | null; name: string },
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    if (!coop.smtpHost) {
      throw new Error('Custom SMTP not configured');
    }

    const transporter = nodemailer.createTransport({
      host: coop.smtpHost,
      port: coop.smtpPort || 587,
      secure: coop.smtpPort === 465,
      auth: coop.smtpUser && coop.smtpPass
        ? { user: coop.smtpUser, pass: coop.smtpPass }
        : undefined,
    });

    await transporter.sendMail({
      from: coop.smtpFrom || `${coop.name} <noreply@opencoop.be>`,
      to,
      subject,
      html,
      attachments,
    });
  }

  private async sendViaGraph(
    coop: {
      graphClientId: string | null;
      graphClientSecret: string | null;
      graphTenantId: string | null;
      graphFromEmail: string | null;
      name: string;
    },
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    if (!coop.graphClientId || !coop.graphClientSecret || !coop.graphTenantId || !coop.graphFromEmail) {
      throw new Error('Microsoft Graph not fully configured');
    }

    const credential = new ClientSecretCredential(
      coop.graphTenantId,
      coop.graphClientId,
      coop.graphClientSecret,
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });

    const client = Client.initWithMiddleware({ authProvider });

    // Build Graph API message
    const message: Record<string, unknown> = {
      subject,
      body: {
        contentType: 'HTML',
        content: html,
      },
      toRecipients: [
        {
          emailAddress: { address: to },
        },
      ],
    };

    // Add attachments if present
    if (attachments && attachments.length > 0) {
      message.attachments = attachments.map((att) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.filename,
        contentBytes: fs.readFileSync(att.path).toString('base64'),
      }));
    }

    await client
      .api(`/users/${coop.graphFromEmail}/sendMail`)
      .post({ message, saveToSentItems: false });
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
      'minor-turned-adult': (d, cn) => `
        <h1>Welkom bij ${cn}, ${d.firstName}!</h1>
        <p>Gefeliciteerd met je 18de verjaardag! 🎉</p>
        <p>Je bent nu volwassen en beheert voortaan zelf je aandelen bij ${cn}.</p>
        <p>Log in op je account om je aandelen te bekijken:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.loginUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Inloggen
          </a>
        </p>
      `,
      'parent-minor-turned-adult': (d, cn) => `
        <h1>${d.minorFirstName} beheert nu zelf de aandelen</h1>
        <p>Beste ouder/voogd,</p>
        <p>${d.minorFirstName} ${d.minorLastName} is 18 geworden en beheert voortaan zelf de aandelen bij ${cn}.</p>
        <p>U hoeft hier verder niets voor te doen. ${d.minorFirstName} kan nu zelfstandig inloggen.</p>
      `,
      'minor-upgrade-notification': (d, cn) => `
        <h1>${d.minorFirstName} is 18 geworden</h1>
        <p>Beste ouder/voogd,</p>
        <p>${d.minorFirstName} ${d.minorLastName} is 18 geworden en kan nu een eigen account aanmaken bij ${cn}.</p>
        <p>Omdat er geen e-mailadres gekend is voor ${d.minorFirstName}, vragen we u om onderstaande link door te geven:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.upgradeUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Account aanmaken
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          Deze link is 90 dagen geldig.
        </p>
      `,
      'minor-upgrade-reminder': (d, cn) => `
        <h1>Herinnering: account aanmaken voor ${d.minorFirstName}</h1>
        <p>Beste ouder/voogd,</p>
        <p>We hebben u eerder gevraagd om onderstaande link door te geven aan ${d.minorFirstName} ${d.minorLastName} voor het aanmaken van een eigen account bij ${cn}.</p>
        <p>De link is nog ${d.daysRemaining} dagen geldig:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.upgradeUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Account aanmaken
          </a>
        </p>
      `,
      'set-minor-email-reminder': (d, cn) => `
        <h1>E-mailadres toevoegen voor ${d.minorFirstName}</h1>
        <p>Beste ouder/voogd,</p>
        <p>${d.minorFirstName} ${d.minorLastName} is aandeelhouder bij ${cn} en wordt over ${d.yearsUntil18} jaar 18.</p>
        <p>Op dat moment krijgt ${d.minorFirstName} een eigen account. Om dit automatisch te laten verlopen, kunt u nu al een e-mailadres toevoegen in het dashboard:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.dashboardUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Naar dashboard
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          Als ${d.minorFirstName} nog geen e-mailadres heeft, kunt u dit later alsnog doen. We sturen u jaarlijks een herinnering.
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
