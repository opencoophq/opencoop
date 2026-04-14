import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminNotificationEvent, AdminNotificationData } from '../admin-notifications/admin-notifications.service';

export interface EmailOptions {
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  /**
   * Send a platform-level email (not tied to a coop).
   * Sends directly via platform SMTP — no queue, no EmailLog.
   * Use for internal notifications, thank-you emails, etc.
   */
  async sendPlatformEmail(options: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    senderName?: string;
  }) {
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.logger.warn('Platform SMTP not configured, skipping email');
      return;
    }

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const defaultFrom = process.env.SMTP_FROM || 'OpenCoop <noreply@opencoop.be>';
    const fromAddress = defaultFrom.match(/<(.+)>/)?.[1] || defaultFrom;
    const from = options.senderName
      ? `${options.senderName} <${fromAddress}>`
      : defaultFrom;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  async send(options: EmailOptions) {
    // Create email log entry
    const emailLog = await this.prisma.emailLog.create({
      data: {
        coopId: options.coopId,
        recipientEmail: options.to,
        subject: options.subject,
        templateKey: options.templateKey,
        status: 'QUEUED',
      },
    });

    // Add to queue
    await this.emailQueue.add('send', {
      emailLogId: emailLog.id,
      ...options,
    });

    return emailLog;
  }

  private async resolveRecipientLanguage(email: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { preferredLanguage: true },
    });
    return user?.preferredLanguage || 'nl';
  }

  async sendWelcomeEmail(coopId: string, to: string, shareholderName: string) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: 'Welkom bij OpenCoop',
      en: 'Welcome to OpenCoop',
      fr: 'Bienvenue sur OpenCoop',
      de: 'Willkommen bei OpenCoop',
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'welcome',
      templateData: { shareholderName, language },
    });
  }

  async sendSharePurchaseConfirmation(
    coopId: string,
    to: string,
    data: {
      shareholderName: string;
      shareClassName: string;
      quantity: number;
      totalAmount: number;
      ogmCode?: string;
      bankIban?: string;
      bankBic?: string;
    },
  ) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: 'Bevestiging van je aandelenaankoop',
      en: 'Share Purchase Confirmation',
      fr: "Confirmation d'achat d'actions",
      de: 'Bestätigung Ihres Anteilskaufs',
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'share-purchase',
      templateData: { ...data, language },
    });
  }

  async sendPaymentConfirmation(
    coopId: string,
    to: string,
    data: {
      shareholderName: string;
      amount: number;
      certificatePath?: string;
      dashboardUrl?: string;
      language?: string;
    },
  ) {
    const lang = data.language || 'nl';
    const subjects: Record<string, string> = {
      nl: 'Betaling ontvangen - Uw aandelen zijn nu actief',
      en: 'Payment Received - Your shares are now active',
      fr: 'Paiement reçu - Vos actions sont maintenant actives',
      de: 'Zahlung erhalten - Ihre Anteile sind jetzt aktiv',
    };

    const attachments = data.certificatePath
      ? [{ filename: 'certificate.pdf', path: data.certificatePath }]
      : undefined;

    return this.send({
      coopId,
      to,
      subject: subjects[lang] || subjects['nl'],
      templateKey: 'payment-confirmed',
      templateData: data,
      attachments,
    });
  }

  async sendDividendStatement(
    coopId: string,
    to: string,
    data: {
      shareholderName: string;
      year: number;
      netAmount: number;
      statementPath: string;
    },
  ) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: `Dividendafrekening ${data.year}`,
      en: `Dividend Statement ${data.year}`,
      fr: `Relevé de dividendes ${data.year}`,
      de: `Dividendenabrechnung ${data.year}`,
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'dividend-statement',
      templateData: { ...data, language },
      attachments: [{ filename: `dividend-${data.year}.pdf`, path: data.statementPath }],
    });
  }

  async sendPasswordReset(coopId: string, to: string, resetUrl: string) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: 'Wachtwoord resetten',
      en: 'Password Reset Request',
      fr: 'Demande de réinitialisation du mot de passe',
      de: 'Passwort zurücksetzen',
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'password-reset',
      templateData: { resetUrl, language },
    });
  }

  async sendMagicLink(coopId: string, to: string, magicLinkUrl: string) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: 'Je inloglink',
      en: 'Your Login Link',
      fr: 'Votre lien de connexion',
      de: 'Ihr Anmeldelink',
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'magic-link',
      templateData: { magicLinkUrl, language },
    });
  }

  async sendMinorUpgradeNotification(
    coopId: string,
    to: string,
    data: {
      minorFirstName: string;
      minorLastName: string;
      coopName: string;
      upgradeUrl: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `${data.minorFirstName} is nu 18 - eigen account aanmaken voor ${data.coopName}`,
      templateKey: 'minor-upgrade-notification',
      templateData: data,
    });
  }

  async sendMinorUpgradeReminder(
    coopId: string,
    to: string,
    data: {
      minorFirstName: string;
      minorLastName: string;
      coopName: string;
      upgradeUrl: string;
      daysRemaining: number;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `Herinnering: ${data.minorFirstName} moet nog een account aanmaken voor ${data.coopName}`,
      templateKey: 'minor-upgrade-reminder',
      templateData: data,
    });
  }

  async sendSetMinorEmailReminder(
    coopId: string,
    to: string,
    data: {
      minorFirstName: string;
      minorLastName: string;
      coopName: string;
      dashboardUrl: string;
      yearsUntil18: number;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `Voeg een e-mailadres toe voor ${data.minorFirstName} bij ${data.coopName}`,
      templateKey: 'set-minor-email-reminder',
      templateData: data,
    });
  }

  async sendMinorTurnedAdultNotification(
    coopId: string,
    to: string,
    data: {
      firstName: string;
      lastName: string;
      coopName: string;
      loginUrl: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `Welkom bij ${data.coopName} - Je bent nu 18!`,
      templateKey: 'minor-turned-adult',
      templateData: data,
    });
  }

  async sendParentMinorTurnedAdultNotification(
    coopId: string,
    to: string,
    data: {
      minorFirstName: string;
      minorLastName: string;
      coopName: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `${data.minorFirstName} beheert nu zelf de aandelen bij ${data.coopName}`,
      templateKey: 'parent-minor-turned-adult',
      templateData: data,
    });
  }

  async sendEmancipationHouseholdNotification(
    coopId: string,
    to: string,
    data: {
      shareholderFirstName: string;
      shareholderLastName: string;
      coopName: string;
      claimUrl: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: `${data.shareholderFirstName} kan nu een eigen account aanmaken bij ${data.coopName}`,
      templateKey: 'emancipation-household',
      templateData: data,
    });
  }

  async sendReferralSuccessNotification(
    coopId: string,
    to: string,
    data: {
      referrerName: string;
      referredName: string;
      dashboardUrl?: string;
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: 'Iemand heeft je uitnodiging aanvaard!',
      templateKey: 'referral-success',
      templateData: data,
    });
  }

  async sendAdminEventNotification(
    coopId: string,
    to: string,
    data: {
      adminName: string;
      coopName: string;
      event: AdminNotificationEvent;
      data: AdminNotificationData;
    },
  ) {
    const subjects: Record<AdminNotificationEvent, string> = {
      new_shareholder: `[${data.coopName}] New shareholder registered`,
      share_purchase: `[${data.coopName}] Share purchase`,
      share_sell: `[${data.coopName}] Share sale`,
      payment_received: `[${data.coopName}] Payment received`,
    };

    return this.send({
      coopId,
      to,
      subject: subjects[data.event],
      templateKey: 'admin-event-notification',
      templateData: data,
    });
  }

  async sendAdminDigest(
    coopId: string,
    to: string,
    data: {
      adminName: string;
      coopName: string;
      frequency: 'DAILY' | 'WEEKLY';
      events: Array<{ event: AdminNotificationEvent; data: AdminNotificationData }>;
    },
  ) {
    const label = data.frequency === 'DAILY' ? 'Daily' : 'Weekly';
    return this.send({
      coopId,
      to,
      subject: `[${data.coopName}] ${label} digest — ${data.events.length} update${data.events.length === 1 ? '' : 's'}`,
      templateKey: 'admin-digest',
      templateData: data,
    });
  }

  async sendGiftCertificate(
    coopId: string,
    to: string,
    data: {
      buyerName: string;
      coopName: string;
      shareClassName: string;
      quantity: number;
      totalValue: number;
      giftCode: string;
      certificatePath: string;
    },
  ) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: `${data.coopName} — Je cadeaubon`,
      en: `${data.coopName} — Your gift certificate`,
      fr: `${data.coopName} — Votre bon cadeau`,
      de: `${data.coopName} — Ihr Geschenkgutschein`,
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'gift-certificate',
      templateData: { ...data, language },
      attachments: [{ filename: 'gift-certificate.pdf', path: data.certificatePath }],
    });
  }
}
