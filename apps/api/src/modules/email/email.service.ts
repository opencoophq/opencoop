import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

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
  }) {
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.logger.warn('Platform SMTP not configured, skipping email');
      return;
    }

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'OpenCoop <noreply@opencoop.be>';

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

  async sendWelcomeEmail(coopId: string, to: string, shareholderName: string) {
    return this.send({
      coopId,
      to,
      subject: 'Welcome to OpenCoop',
      templateKey: 'welcome',
      templateData: { shareholderName },
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
    },
  ) {
    return this.send({
      coopId,
      to,
      subject: 'Share Purchase Confirmation',
      templateKey: 'share-purchase',
      templateData: data,
    });
  }

  async sendPaymentConfirmation(
    coopId: string,
    to: string,
    data: {
      shareholderName: string;
      amount: number;
      certificatePath?: string;
    },
  ) {
    const attachments = data.certificatePath
      ? [{ filename: 'certificate.pdf', path: data.certificatePath }]
      : undefined;

    return this.send({
      coopId,
      to,
      subject: 'Payment Received - Your shares are now active',
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
    return this.send({
      coopId,
      to,
      subject: `Dividend Statement ${data.year}`,
      templateKey: 'dividend-statement',
      templateData: data,
      attachments: [{ filename: `dividend-${data.year}.pdf`, path: data.statementPath }],
    });
  }

  async sendPasswordReset(coopId: string, to: string, resetUrl: string) {
    return this.send({
      coopId,
      to,
      subject: 'Password Reset Request',
      templateKey: 'password-reset',
      templateData: { resetUrl },
    });
  }

  async sendMagicLink(coopId: string, to: string, magicLinkUrl: string) {
    return this.send({
      coopId,
      to,
      subject: 'Your Login Link',
      templateKey: 'magic-link',
      templateData: { magicLinkUrl },
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
}
