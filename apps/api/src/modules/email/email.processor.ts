import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import {
  TokenCredentialAuthenticationProvider,
} from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { buildCopy, getCopy } from './email-copy';

/**
 * Escape HTML-significant characters so user/coop-controlled free text can be
 * safely interpolated into email HTML without allowing markup/script injection
 * (audit Q5). Only use for plain-text values — never for trusted URLs, numbers,
 * system-generated codes, or intentionally pre-rendered HTML.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  meta?: {
    kind?: string;
    attendanceId?: string;
  };
}

@Processor('email')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private prisma: PrismaService) {}

  private resolveMeetingLocale(language: string): string {
    const localeMap: Record<string, string> = {
      nl: 'nl-BE',
      en: 'en-US',
      fr: 'fr-BE',
      de: 'de-DE',
    };
    return localeMap[language] || 'nl-BE';
  }

  private formatMeetingDate(raw: unknown, language: string): string {
    const fallback = String(raw ?? '');
    if (!fallback) return '';

    try {
      const parsed = new Date(fallback);
      if (Number.isNaN(parsed.getTime())) return fallback;

      return new Intl.DateTimeFormat(this.resolveMeetingLocale(language), {
        dateStyle: 'full',
        timeStyle: 'short',
        // AGM scheduling is currently Belgium-only. Make the rendered hour
        // deterministic even when the API worker runs in UTC.
        timeZone: process.env.MEETING_TIME_ZONE ?? 'Europe/Brussels',
      }).format(parsed);
    } catch {
      return fallback;
    }
  }

  @Process('send')
  async handleSend(job: Job<EmailJob>) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'email');
      scope.setTag('job', 'send');
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
          await this.sendViaPlatformSmtp(coop.name, coop.coopEmail, to, subject, html, attachments);
        }

        // Update email log
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        if (job.data.meta?.kind === 'documents-email' && job.data.meta?.attendanceId) {
          await this.prisma.meetingAttendance.update({
            where: { id: job.data.meta.attendanceId },
            data: { documentsEmailSentAt: new Date(), documentsEmailError: null },
          }).catch(() => undefined);
        }
      } catch (error) {
        Sentry.captureException(error);

        // Update email log with error
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        if (job.data.meta?.kind === 'documents-email' && job.data.meta?.attendanceId) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await this.prisma.meetingAttendance.update({
            where: { id: job.data.meta.attendanceId },
            data: { documentsEmailError: errMsg.slice(0, 500) },
          }).catch(() => undefined);
        }

        throw error;
      }
    });
  }

  private async sendViaPlatformSmtp(
    coopName: string,
    replyTo: string | null,
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ filename: string; path: string }>,
  ) {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    // Always use coop name as display name; extract address from SMTP_FROM
    const envFrom = process.env.SMTP_FROM;
    const addressMatch = envFrom?.match(/<([^>]+)>/);
    const fromAddress = addressMatch ? addressMatch[1] : envFrom?.trim() || 'noreply@opencoop.be';
    const from = `${coopName} <${fromAddress}>`;

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
      replyTo: replyTo ?? undefined,
      to,
      subject,
      html,
      attachments,
    });
  }

  private async sendViaSmtp(
    coop: { smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPass: string | null; smtpFrom: string | null; coopEmail: string | null; name: string },
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
      replyTo: coop.coopEmail ?? undefined,
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
      coopEmail: string | null;
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
      // replyTo routes member replies to the coop's preferred address
      ...(coop.coopEmail ? { replyTo: [{ emailAddress: { address: coop.coopEmail } }] } : {}),
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

  // Public so other modules (e.g. meetings convocation preview) can render
  // template HTML synchronously without going through the queue.
  public renderTemplate(
    templateKey: string,
    data: Record<string, unknown>,
    coopName: string,
  ): string {
    // Simple template rendering - in production, use a proper template engine
    const templates: Record<string, (data: Record<string, unknown>, coopName: string) => string> = {
      welcome: (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('welcome', lang, { coopName: ecn, shareholderName: sn });
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.thanks}</p>
    <p>${s.login}</p>
  `;
      },
      'share-purchase': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('share-purchase', lang, { coopName: ecn, shareholderName: sn });
        const amount = (d.totalAmount as number).toFixed(2);
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.intro}</p>

    <h2>${s.orderTitle}</h2>
    <ul>
      <li>${s.shareClass}: ${escapeHtml(d.shareClassName)}</li>
      <li>${s.quantity}: ${d.quantity}</li>
      <li>${s.totalAmount}: €${amount}</li>
    </ul>

    ${d.bankIban || d.ogmCode ? `
    <h2>${s.paymentDetailsTitle}</h2>
    <p>${s.beneficiary}: <strong>${ecn}</strong></p>
    ${d.bankIban ? `<p>${s.iban}: <strong>${d.bankIban}</strong></p>` : ''}
    <p>${s.amount}: <strong>€${amount}</strong></p>
    ${d.ogmCode ? `<p>${s.ogm}: <strong>${d.ogmCode}</strong></p>` : ''}
    ` : ''}

    <h2>${s.nextTitle}</h2>
    <ol>
      <li>${s.step1}</li>
      <li>${s.step2}</li>
      <li>${s.step3}</li>
    </ol>
    <p><em>${s.noHaste}</em></p>

    <p>${s.thanks}</p>
  `;
      },
      'payment-confirmed': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('payment-confirmed', lang, {
          coopName: ecn,
          shareholderName: sn,
          amount: (d.amount as number).toFixed(2),
        });
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.received}</p>
          <p>${s.active}</p>
          ${d.dashboardUrl ? `
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.dashboardUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${s.dashboard}
            </a>
          </p>
          ` : ''}
          <p>${s.thanks}</p>
        `;
      },
      'dividend-statement': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('dividend-statement', lang, {
          coopName: ecn,
          shareholderName: sn,
          year: String(d.year),
        });
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.attached}</p>
    <p>${s.net}: €${(d.netAmount as number).toFixed(2)}</p>
    <p>${s.thanks}</p>
  `;
      },
      'password-reset': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const s = buildCopy('password-reset', lang);
        return `
    <h1>${s.title}</h1>
    <p>${s.requested}</p>
    <p>${s.click}</p>
    <p><a href="${d.resetUrl}">${d.resetUrl}</a></p>
    <p>${s.ignore}</p>
    <p>${s.expires}</p>
  `;
      },
      'magic-link': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const s = buildCopy('magic-link', lang);
        return `
    <h1>${s.title}</h1>
    <p>${s.click}</p>
    <p style="text-align: center; margin: 30px 0;">
      <a href="${d.magicLinkUrl}"
         style="background-color: #1e40af; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 6px; display: inline-block;">
        ${s.button}
      </a>
    </p>
    <p style="color: #666; font-size: 12px;">
      ${s.expires}
    </p>
  `;
      },
      'minor-turned-adult': (d, cn) => `
        <h1>Welkom bij ${escapeHtml(cn)}, ${escapeHtml(d.firstName)}!</h1>
        <p>Gefeliciteerd met je 18de verjaardag! 🎉</p>
        <p>Je bent nu volwassen en beheert voortaan zelf je aandelen bij ${escapeHtml(cn)}.</p>
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
        <h1>${escapeHtml(d.minorFirstName)} beheert nu zelf de aandelen</h1>
        <p>Beste ouder/voogd,</p>
        <p>${escapeHtml(d.minorFirstName)} ${escapeHtml(d.minorLastName)} is 18 geworden en beheert voortaan zelf de aandelen bij ${escapeHtml(cn)}.</p>
        <p>U hoeft hier verder niets voor te doen. ${escapeHtml(d.minorFirstName)} kan nu zelfstandig inloggen.</p>
      `,
      'minor-upgrade-notification': (d, cn) => `
        <h1>${escapeHtml(d.minorFirstName)} is 18 geworden</h1>
        <p>Beste ouder/voogd,</p>
        <p>${escapeHtml(d.minorFirstName)} ${escapeHtml(d.minorLastName)} is 18 geworden en kan nu een eigen account aanmaken bij ${escapeHtml(cn)}.</p>
        <p>Omdat er geen e-mailadres gekend is voor ${escapeHtml(d.minorFirstName)}, vragen we u om onderstaande link door te geven:</p>
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
        <h1>Herinnering: account aanmaken voor ${escapeHtml(d.minorFirstName)}</h1>
        <p>Beste ouder/voogd,</p>
        <p>We hebben u eerder gevraagd om onderstaande link door te geven aan ${escapeHtml(d.minorFirstName)} ${escapeHtml(d.minorLastName)} voor het aanmaken van een eigen account bij ${escapeHtml(cn)}.</p>
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
        <h1>E-mailadres toevoegen voor ${escapeHtml(d.minorFirstName)}</h1>
        <p>Beste ouder/voogd,</p>
        <p>${escapeHtml(d.minorFirstName)} ${escapeHtml(d.minorLastName)} is aandeelhouder bij ${escapeHtml(cn)} en wordt over ${d.yearsUntil18} jaar 18.</p>
        <p>Op dat moment krijgt ${escapeHtml(d.minorFirstName)} een eigen account. Om dit automatisch te laten verlopen, kunt u nu al een e-mailadres toevoegen in het dashboard:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.dashboardUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Naar dashboard
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          Als ${escapeHtml(d.minorFirstName)} nog geen e-mailadres heeft, kunt u dit later alsnog doen. We sturen u jaarlijks een herinnering.
        </p>
      `,
      'gift-certificate': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const bn = escapeHtml(d.buyerName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('gift-certificate', lang, { coopName: ecn, buyerName: bn });
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.thanks}</p>
    <p>${s.received}</p>
    <ul>
      <li>${s.shareClass}: ${escapeHtml(d.shareClassName)}</li>
      <li>${s.quantity}: ${d.quantity}</li>
      <li>${s.totalValue}: €${(d.totalValue as number).toFixed(2)}</li>
    </ul>
    <p>${s.giftCode}: <strong>${d.giftCode}</strong></p>
    <p>${s.share}</p>
    <p>${s.thanksEnd}</p>
  `;
      },
      'message-notification': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('message-notification', lang, { coopName: ecn, shareholderName: sn });
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.body}</p>
          <p><strong>${s.subject}:</strong> ${escapeHtml(d.messageSubject)}</p>
          <blockquote style="border-left: 3px solid #1e40af; padding-left: 12px; color: #555;">
            ${escapeHtml(d.messagePreview)}
          </blockquote>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.inboxUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${s.viewMessage}
            </a>
          </p>
        `;
      },
      'admin-message-notification': (d, cn) => `
        <h1>Nieuw bericht ontvangen</h1>
        <p>Beste ${escapeHtml(d.adminName)},</p>
        <p>Er is een nieuw bericht ontvangen in ${escapeHtml(cn)}.</p>
        <p><strong>Onderwerp:</strong> ${escapeHtml(d.messageSubject)}</p>
        <blockquote style="border-left: 3px solid #1e40af; padding-left: 12px; color: #555;">
          ${escapeHtml(d.messagePreview)}...
        </blockquote>
        <p>Log in op het dashboard om het bericht te bekijken en te beantwoorden.</p>
      `,
      'admin-event-notification': (d, _cn) => {
        const event = d.event as string;
        const data = d.data as Record<string, unknown>;
        const eventLabels: Record<string, string> = {
          new_shareholder: 'New shareholder registered',
          share_purchase: 'Share purchase',
          share_sell: 'Share sale',
          payment_received: 'Payment received',
        };
        const label = eventLabels[event] || event;

        const details: string[] = [];
        if (data.shareholderName) details.push(`<li><strong>Shareholder:</strong> ${escapeHtml(data.shareholderName)}</li>`);
        if (data.shareClassName) details.push(`<li><strong>Share class:</strong> ${escapeHtml(data.shareClassName)}</li>`);
        if (data.quantity) details.push(`<li><strong>Quantity:</strong> ${data.quantity}</li>`);
        if (data.totalAmount !== undefined) details.push(`<li><strong>Total amount:</strong> €${(data.totalAmount as number).toFixed(2)}</li>`);
        if (data.paymentAmount !== undefined) details.push(`<li><strong>Payment amount:</strong> €${(data.paymentAmount as number).toFixed(2)}</li>`);

        return `
          <h1>${label}</h1>
          <p>Dear ${escapeHtml(d.adminName)},</p>
          <p>A new event has occurred in <strong>${escapeHtml(d.coopName)}</strong>:</p>
          <ul>${details.join('')}</ul>
          <p style="color: #666; font-size: 12px;">
            You are receiving this because you enabled this notification in your admin profile.
          </p>
        `;
      },
      'admin-digest': (d, _cn) => {
        const events = d.events as Array<{ event: string; data: Record<string, unknown> }>;
        const frequency = d.frequency as string;
        const label = frequency === 'DAILY' ? 'daily' : 'weekly';

        const eventLabels: Record<string, string> = {
          new_shareholder: 'New shareholder registered',
          share_purchase: 'Share purchase',
          share_sell: 'Share sale',
          payment_received: 'Payment received',
        };

        const rows = events.map((e) => {
          const parts: string[] = [];
          if (e.data.shareholderName) parts.push(`${escapeHtml(e.data.shareholderName)}`);
          if (e.data.shareClassName) parts.push(`${e.data.quantity ?? ''} × ${escapeHtml(e.data.shareClassName)}`);
          if (e.data.totalAmount !== undefined) parts.push(`€${(e.data.totalAmount as number).toFixed(2)}`);
          if (e.data.paymentAmount !== undefined) parts.push(`€${(e.data.paymentAmount as number).toFixed(2)}`);
          return `<tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${eventLabels[e.event] || e.event}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #555;">${parts.join(' — ')}</td>
          </tr>`;
        }).join('');

        return `
          <h1>Your ${label} digest for ${escapeHtml(d.coopName)}</h1>
          <p>Dear ${escapeHtml(d.adminName)},</p>
          <p>Here is a summary of activity in <strong>${escapeHtml(d.coopName)}</strong> over the past ${frequency === 'DAILY' ? '24 hours' : '7 days'}:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px; background: #f5f5f5; border-bottom: 2px solid #ddd;">Event</th>
                <th style="text-align: left; padding: 8px; background: #f5f5f5; border-bottom: 2px solid #ddd;">Details</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color: #666; font-size: 12px;">
            You are receiving this ${label} digest because you enabled it in your admin profile.
          </p>
        `;
      },
      'meeting-convocation': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const customBody = (d.customBody as string) || '';
        const coopName = (d.coopName as string) || cn;
        const ecoopName = escapeHtml(coopName);
        const sn = escapeHtml(d.shareholderName);
        const meetingTitle = escapeHtml(d.meetingTitle);
        const meetingLocation = escapeHtml(d.meetingLocation);
        const coopLogoUrl = (d.coopLogoUrl as string) || '';
        const brandColor = (d.coopPrimaryColor as string) || '#1e40af';
        const humanDate = this.formatMeetingDate(d.meetingDate, lang);

        // Location uses a language-specific fallback when empty; resolve it from
        // the raw copy first so it can feed the {meetingLocation} token.
        const locationTbd = getCopy('meeting-convocation', lang).locationTbd ?? '';
        const s = buildCopy('meeting-convocation', lang, {
          coopName: ecoopName,
          shareholderName: sn,
          meetingTitle,
          humanDate,
          meetingLocation: meetingLocation || locationTbd,
        });
        const items = (d.agendaItems as Array<{ order: number; title: string; description?: string }>) || [];
        const agendaHtml = items
          .sort((a, b) => a.order - b.order)
          .map((i) => `<li><strong>${escapeHtml(i.title)}</strong>${i.description ? `<br><span style="color:#555;">${escapeHtml(i.description)}</span>` : ''}</li>`)
          .join('');
        const logoBlock = coopLogoUrl
          ? `<div style="text-align: center; margin-bottom: 24px;">
               <img src="${coopLogoUrl}" alt="${ecoopName}" style="max-height: 80px; max-width: 240px;" />
             </div>`
          : '';
        const headerBlock = `
          <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 14px; margin-bottom: 22px;">
            ${logoBlock}
            <h1 style="margin: 0; color: ${brandColor}; font-size: 22px;">${s.title}</h1>
            <p style="margin: 4px 0 0; color: #555; font-size: 14px;">${s.subtitle}</p>
          </div>`;
        const ctaButton = `
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.rsvpUrl}"
               style="background-color: ${brandColor}; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: 600;">
              ${s.cta}
            </a>
          </p>`;

        // Custom body path: admin-supplied HTML with template-variable substitution.
        // We substitute then check whether the body references the RSVP link in
        // any way; if not, we append the standard CTA button so the link is
        // never accidentally omitted.
        if (customBody) {
          const substituted = customBody
            .replaceAll('{{rsvpUrl}}', String(d.rsvpUrl ?? ''))
            .replaceAll('{{shareholderName}}', sn)
            .replaceAll('{{meetingTitle}}', meetingTitle)
            .replaceAll('{{meetingDate}}', humanDate)
            .replaceAll('{{meetingLocation}}', meetingLocation)
            .replaceAll('{{agendaList}}', agendaHtml ? `<ol>${agendaHtml}</ol>` : '')
            .replaceAll('{{coopName}}', ecoopName);
          const hasRsvpLink = /rsvpurl|\/meetings\/rsvp\//i.test(substituted);
          return headerBlock + substituted + (hasRsvpLink ? '' : ctaButton);
        }

        return `
          ${headerBlock}
          <p>${s.dear}</p>
          <p>${s.intro}</p>
          <h2 style="color: ${brandColor};">${s.agendaTitle}</h2>
          <ol>${agendaHtml}</ol>
          ${ctaButton}
          <p>${s.proxy}</p>
          <p style="color: #666; font-size: 12px;">${s.attachment}</p>
          <p>${s.closing}<br><strong>${s.signoff}</strong></p>
        `;
      },
      'meeting-rsvp-confirmation': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const status = (d.rsvpStatus as string) || 'ATTENDING';
        const delegateName = escapeHtml(d.delegateName);
        const coopName = (d.coopName as string) || cn;
        const ecoopName = escapeHtml(coopName);
        const sn = escapeHtml(d.shareholderName);
        const meetingTitle = escapeHtml(d.meetingTitle);
        const meetingLocation = escapeHtml(d.meetingLocation);
        const coopLogoUrl = (d.coopLogoUrl as string) || '';
        const brandColor = (d.coopPrimaryColor as string) || '#1e40af';
        const humanDate = this.formatMeetingDate(d.meetingDate, lang);

        const s = buildCopy('meeting-rsvp-confirmation', lang, {
          coopName: ecoopName,
          shareholderName: sn,
          meetingTitle,
          humanDate,
          meetingLocation,
          delegateName,
        });
        // Location is conditionally rendered; pick the matching copy variant so
        // output stays byte-identical to the previous inline ternary.
        s.meeting = d.meetingLocation ? s.meetingWithLocation : s.meetingNoLocation;
        const body = status === 'PROXY' ? s.proxy : status === 'ABSENT' ? s.absent : s.attending;
        const showAttachment = status === 'ATTENDING' || status === 'PROXY';

        const logoBlock = coopLogoUrl
          ? `<div style="text-align: center; margin-bottom: 24px;">
               <img src="${coopLogoUrl}" alt="${ecoopName}" style="max-height: 80px; max-width: 240px;" />
             </div>`
          : '';
        const headerBlock = `
          <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 14px; margin-bottom: 22px;">
            ${logoBlock}
            <h1 style="margin: 0; color: ${brandColor}; font-size: 22px;">${s.title}</h1>
            <p style="margin: 4px 0 0; color: #555; font-size: 14px;">${s.subtitle}</p>
          </div>`;
        const changeButton = d.rsvpUrl
          ? `<p style="text-align: center; margin: 30px 0;">
               <a href="${d.rsvpUrl}"
                  style="background-color: ${brandColor}; color: white; padding: 12px 24px;
                         text-decoration: none; border-radius: 6px; display: inline-block;
                         font-weight: 600;">
                 ${s.change}
               </a>
             </p>`
          : '';
        return `
          ${headerBlock}
          <p>${s.dear}</p>
          <p>${s.meeting}</p>
          <p><strong>${body}</strong></p>
          ${showAttachment ? `<p style="color: #666; font-size: 12px;">${s.attachment}</p>` : ''}
          ${changeButton}
          <p>${s.closing}<br><strong>${s.signoff}</strong></p>
        `;
      },
      'meeting-reminder': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const days = (d.daysUntil as number) ?? 0;
        const humanDate = this.formatMeetingDate(d.meetingDate, lang);
        const sn = escapeHtml(d.shareholderName);
        const meetingTitle = escapeHtml(d.meetingTitle);
        const s = buildCopy('meeting-reminder', lang, {
          shareholderName: sn,
          meetingTitle,
          days: String(days),
          humanDate,
        });
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.body}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.rsvpUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${s.cta}
            </a>
          </p>
        `;
      },
      'referral-success': (d, cn) => `
        <h1>Iemand heeft je uitnodiging aanvaard!</h1>
        <p>Beste ${escapeHtml(d.referrerName)},</p>
        <p><strong>${escapeHtml(d.referredName)}</strong> heeft zich via jouw persoonlijke link aangemeld als coöperant bij ${escapeHtml(cn)}.</p>
        <p>Bedankt om ${escapeHtml(cn)} te helpen groeien! Deel je link gerust verder om meer mensen te bereiken.</p>
        ${d.dashboardUrl ? `
        <p style="text-align: center; margin: 30px 0;">
          <a href="${d.dashboardUrl}"
             style="background-color: #1e40af; color: white; padding: 12px 24px;
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Bekijk je doorverwijzingen
          </a>
        </p>
        ` : ''}
      `,
      'agenda-documents': (d, _cn) => {
        const introHtml = d.introHtml as string;
        const documents = d.documents as Array<{ fileName: string; downloadUrl: string }>;
        const meetingTitle = d.meetingTitle as string;
        const meetingScheduledAt = d.meetingScheduledAt as string;
        const rsvpUrl = d.rsvpUrl as string;
        const pixelUrl = d.pixelUrl as string;

        const esc = (s: string) =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const docsList = documents
          .map(
            (doc) => `
        <p style="margin: 8px 0;">
          <a href="${esc(doc.downloadUrl)}" style="background:#0E7C66;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">
            ${esc(doc.fileName)}
          </a>
        </p>`,
          )
          .join('\n');

        return `
    <h2>${esc(meetingTitle)}</h2>
    <p>${esc(meetingScheduledAt)}</p>
    ${introHtml}
    <h3>Documenten</h3>
    ${docsList}
    <hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5;" />
    <p style="font-size:14px;color:#666;">
      Heb je je aanwezigheid nog niet bevestigd? <a href="${esc(rsvpUrl)}">Bevestig hier</a>.
    </p>
    <img src="${esc(pixelUrl)}" width="1" height="1" alt="" style="display:block" />
  `;
      },
    };

    const template = templates[templateKey];
    if (!template) {
      return `<p>Email template not found: ${escapeHtml(templateKey)}</p>`;
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
          This email was sent by ${escapeHtml(coopName)} via OpenCoop.
        </p>
      </body>
      </html>
    `;
  }
}
