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
        Sentry.captureException(error);

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
    });
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
      welcome: (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: `Welkom bij ${cn}!`,
            dear: `Beste ${d.shareholderName},`,
            thanks: `Bedankt om aandeelhouder te worden van ${cn}.`,
            login: 'Je kan inloggen in je dashboard om je aandelen en documenten te bekijken.',
          },
          en: {
            title: `Welcome to ${cn}!`,
            dear: `Dear ${d.shareholderName},`,
            thanks: `Thank you for becoming a shareholder of ${cn}.`,
            login: 'You can log in to your dashboard to view your shares and documents.',
          },
          fr: {
            title: `Bienvenue chez ${cn} !`,
            dear: `Cher/Chère ${d.shareholderName},`,
            thanks: `Merci de devenir actionnaire de ${cn}.`,
            login: 'Vous pouvez vous connecter à votre tableau de bord pour consulter vos actions et documents.',
          },
          de: {
            title: `Willkommen bei ${cn}!`,
            dear: `Liebe/r ${d.shareholderName},`,
            thanks: `Vielen Dank, dass Sie Anteilseigner von ${cn} werden.`,
            login: 'Sie können sich in Ihrem Dashboard anmelden, um Ihre Anteile und Dokumente einzusehen.',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.thanks}</p>
    <p>${s.login}</p>
  `;
      },
      'share-purchase': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: 'Bevestiging van je aandelenaankoop',
            dear: `Beste ${d.shareholderName},`,
            intro: 'We hebben je aanvraag voor een aandelenaankoop goed ontvangen:',
            shareClass: 'Aandelenklasse',
            quantity: 'Aantal',
            totalAmount: 'Totaalbedrag',
            paymentDetailsTitle: 'Betalingsgegevens',
            iban: 'IBAN',
            bic: 'BIC',
            ogm: 'Gestructureerde mededeling',
            amount: 'Bedrag',
            thanks: `Bedankt om te investeren in ${cn}!`,
          },
          en: {
            title: 'Share Purchase Confirmation',
            dear: `Dear ${d.shareholderName},`,
            intro: 'We have received your share purchase request:',
            shareClass: 'Share Class',
            quantity: 'Quantity',
            totalAmount: 'Total Amount',
            paymentDetailsTitle: 'Payment Details',
            iban: 'IBAN',
            bic: 'BIC',
            ogm: 'Structured communication',
            amount: 'Amount',
            thanks: `Thank you for investing in ${cn}!`,
          },
          fr: {
            title: "Confirmation d'achat d'actions",
            dear: `Cher/Chère ${d.shareholderName},`,
            intro: "Nous avons bien reçu votre demande d'achat d'actions :",
            shareClass: "Classe d'actions",
            quantity: 'Quantité',
            totalAmount: 'Montant total',
            paymentDetailsTitle: 'Détails de paiement',
            iban: 'IBAN',
            bic: 'BIC',
            ogm: 'Communication structurée',
            amount: 'Montant',
            thanks: `Merci d'investir dans ${cn} !`,
          },
          de: {
            title: 'Bestätigung Ihres Anteilskaufs',
            dear: `Liebe/r ${d.shareholderName},`,
            intro: 'Wir haben Ihre Anfrage zum Anteilskauf erhalten:',
            shareClass: 'Anteilsklasse',
            quantity: 'Anzahl',
            totalAmount: 'Gesamtbetrag',
            paymentDetailsTitle: 'Zahlungsdetails',
            iban: 'IBAN',
            bic: 'BIC',
            ogm: 'Strukturierte Mitteilung',
            amount: 'Betrag',
            thanks: `Vielen Dank für Ihre Investition in ${cn}!`,
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.intro}</p>
    <ul>
      <li>${s.shareClass}: ${d.shareClassName}</li>
      <li>${s.quantity}: ${d.quantity}</li>
      <li>${s.totalAmount}: €${(d.totalAmount as number).toFixed(2)}</li>
    </ul>
    ${d.bankIban || d.ogmCode ? `
    <h2>${s.paymentDetailsTitle}</h2>
    ${d.bankIban ? `<p>${s.iban}: <strong>${d.bankIban}</strong></p>` : ''}
    ${d.bankBic ? `<p>${s.bic}: <strong>${d.bankBic}</strong></p>` : ''}
    ${d.ogmCode ? `<p>${s.ogm}: <strong>${d.ogmCode}</strong></p>` : ''}
    <p>${s.amount}: <strong>€${(d.totalAmount as number).toFixed(2)}</strong></p>
    ` : ''}
    <p>${s.thanks}</p>
  `;
      },
      'payment-confirmed': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: 'Betaling bevestigd',
            dear: `Beste ${d.shareholderName},`,
            received: `We hebben uw betaling van €${(d.amount as number).toFixed(2)} ontvangen.`,
            active: 'Uw aandelen zijn nu actief. Uw aandeelhoudersattest vindt u als bijlage.',
            dashboard: 'Bekijk mijn dashboard',
            thanks: `Bedankt om aandeelhouder te zijn van ${cn}!`,
          },
          en: {
            title: 'Payment Confirmed',
            dear: `Dear ${d.shareholderName},`,
            received: `We have received your payment of €${(d.amount as number).toFixed(2)}.`,
            active: 'Your shares are now active. Please find your share certificate attached.',
            dashboard: 'View my dashboard',
            thanks: `Thank you for being a shareholder of ${cn}!`,
          },
          fr: {
            title: 'Paiement confirmé',
            dear: `Cher/Chère ${d.shareholderName},`,
            received: `Nous avons reçu votre paiement de €${(d.amount as number).toFixed(2)}.`,
            active: "Vos actions sont maintenant actives. Veuillez trouver votre certificat d'actionnaire en pièce jointe.",
            dashboard: 'Voir mon tableau de bord',
            thanks: `Merci d'être actionnaire de ${cn}!`,
          },
          de: {
            title: 'Zahlung bestätigt',
            dear: `Liebe/r ${d.shareholderName},`,
            received: `Wir haben Ihre Zahlung von €${(d.amount as number).toFixed(2)} erhalten.`,
            active: 'Ihre Anteile sind jetzt aktiv. Bitte finden Sie Ihr Anteilszertifikat im Anhang.',
            dashboard: 'Mein Dashboard anzeigen',
            thanks: `Vielen Dank, dass Sie Anteilseigner von ${cn} sind!`,
          },
        };
        const s = t[lang as keyof typeof t] || t['en'];
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
        const t = {
          nl: {
            title: `Dividendafrekening ${d.year}`,
            dear: `Beste ${d.shareholderName},`,
            attached: `In bijlage vind je je dividendafrekening voor ${d.year}.`,
            net: 'Netto dividendbedrag',
            thanks: `Bedankt om aandeelhouder te zijn van ${cn}!`,
          },
          en: {
            title: `Dividend Statement ${d.year}`,
            dear: `Dear ${d.shareholderName},`,
            attached: `Please find attached your dividend statement for ${d.year}.`,
            net: 'Net dividend amount',
            thanks: `Thank you for being a shareholder of ${cn}!`,
          },
          fr: {
            title: `Relevé de dividendes ${d.year}`,
            dear: `Cher/Chère ${d.shareholderName},`,
            attached: `Veuillez trouver ci-joint votre relevé de dividendes pour ${d.year}.`,
            net: 'Montant net du dividende',
            thanks: `Merci d'être actionnaire de ${cn} !`,
          },
          de: {
            title: `Dividendenabrechnung ${d.year}`,
            dear: `Liebe/r ${d.shareholderName},`,
            attached: `Bitte finden Sie im Anhang Ihre Dividendenabrechnung für ${d.year}.`,
            net: 'Netto-Dividendenbetrag',
            thanks: `Vielen Dank, dass Sie Anteilseigner von ${cn} sind!`,
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
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
        const t = {
          nl: {
            title: 'Wachtwoord resetten',
            requested: 'Je hebt een wachtwoord reset aangevraagd.',
            click: 'Klik op onderstaande link om je wachtwoord te resetten:',
            ignore: 'Als je dit niet hebt aangevraagd, kan je deze e-mail negeren.',
            expires: 'Deze link vervalt binnen 1 uur.',
          },
          en: {
            title: 'Password Reset Request',
            requested: 'You have requested to reset your password.',
            click: 'Click the link below to reset your password:',
            ignore: 'If you did not request this, please ignore this email.',
            expires: 'This link will expire in 1 hour.',
          },
          fr: {
            title: 'Demande de réinitialisation du mot de passe',
            requested: 'Vous avez demandé la réinitialisation de votre mot de passe.',
            click: 'Cliquez sur le lien ci-dessous pour réinitialiser votre mot de passe :',
            ignore: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.",
            expires: 'Ce lien expirera dans 1 heure.',
          },
          de: {
            title: 'Passwort zurücksetzen',
            requested: 'Sie haben eine Passwort-Zurücksetzung angefordert.',
            click: 'Klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:',
            ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.',
            expires: 'Dieser Link läuft in 1 Stunde ab.',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        return `
    <h1>${s.title}</h1>
    <p>${s.requested}</p>
    <p>${s.click}</p>
    <p><a href="${d.resetUrl}">${d.resetUrl}</a></p>
    <p>${s.ignore}</p>
    <p>${s.expires}</p>
  `;
      },
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
      'gift-certificate': (d, cn) => `
        <h1>Your Gift Certificate</h1>
        <p>Dear ${d.buyerName},</p>
        <p>Thank you for purchasing a gift certificate at ${cn}!</p>
        <p>Your payment has been received and the gift certificate is attached to this email.</p>
        <ul>
          <li>Share Class: ${d.shareClassName}</li>
          <li>Quantity: ${d.quantity}</li>
          <li>Total Value: €${(d.totalValue as number).toFixed(2)}</li>
        </ul>
        <p>Gift code: <strong>${d.giftCode}</strong></p>
        <p>Share this certificate with the recipient. They can use the code or QR code to claim their shares.</p>
        <p>Thank you for being a shareholder of ${cn}!</p>
      `,
      'message-notification': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: `Nieuw bericht van ${cn}`,
            dear: `Beste ${d.shareholderName},`,
            body: `U heeft een nieuw bericht ontvangen van ${cn}.`,
            subject: 'Onderwerp',
            viewMessage: 'Bekijk het bericht',
          },
          en: {
            title: `New message from ${cn}`,
            dear: `Dear ${d.shareholderName},`,
            body: `You have received a new message from ${cn}.`,
            subject: 'Subject',
            viewMessage: 'View message',
          },
          fr: {
            title: `Nouveau message de ${cn}`,
            dear: `Cher/Chère ${d.shareholderName},`,
            body: `Vous avez reçu un nouveau message de ${cn}.`,
            subject: 'Sujet',
            viewMessage: 'Voir le message',
          },
          de: {
            title: `Neue Nachricht von ${cn}`,
            dear: `Liebe/r ${d.shareholderName},`,
            body: `Sie haben eine neue Nachricht von ${cn} erhalten.`,
            subject: 'Betreff',
            viewMessage: 'Nachricht anzeigen',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.body}</p>
          <p><strong>${s.subject}:</strong> ${d.messageSubject}</p>
          <blockquote style="border-left: 3px solid #1e40af; padding-left: 12px; color: #555;">
            ${d.messagePreview}
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
        <p>Beste ${d.adminName},</p>
        <p>Er is een nieuw bericht ontvangen in ${cn}.</p>
        <p><strong>Onderwerp:</strong> ${d.messageSubject}</p>
        <blockquote style="border-left: 3px solid #1e40af; padding-left: 12px; color: #555;">
          ${d.messagePreview}...
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
        if (data.shareholderName) details.push(`<li><strong>Shareholder:</strong> ${data.shareholderName}</li>`);
        if (data.shareClassName) details.push(`<li><strong>Share class:</strong> ${data.shareClassName}</li>`);
        if (data.quantity) details.push(`<li><strong>Quantity:</strong> ${data.quantity}</li>`);
        if (data.totalAmount !== undefined) details.push(`<li><strong>Total amount:</strong> €${(data.totalAmount as number).toFixed(2)}</li>`);
        if (data.paymentAmount !== undefined) details.push(`<li><strong>Payment amount:</strong> €${(data.paymentAmount as number).toFixed(2)}</li>`);

        return `
          <h1>${label}</h1>
          <p>Dear ${d.adminName},</p>
          <p>A new event has occurred in <strong>${d.coopName}</strong>:</p>
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
          if (e.data.shareholderName) parts.push(`${e.data.shareholderName}`);
          if (e.data.shareClassName) parts.push(`${e.data.quantity ?? ''} × ${e.data.shareClassName}`);
          if (e.data.totalAmount !== undefined) parts.push(`€${(e.data.totalAmount as number).toFixed(2)}`);
          if (e.data.paymentAmount !== undefined) parts.push(`€${(e.data.paymentAmount as number).toFixed(2)}`);
          return `<tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${eventLabels[e.event] || e.event}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #555;">${parts.join(' — ')}</td>
          </tr>`;
        }).join('');

        return `
          <h1>Your ${label} digest for ${d.coopName}</h1>
          <p>Dear ${d.adminName},</p>
          <p>Here is a summary of activity in <strong>${d.coopName}</strong> over the past ${frequency === 'DAILY' ? '24 hours' : '7 days'}:</p>
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
      'referral-success': (d, cn) => `
        <h1>Iemand heeft je uitnodiging aanvaard!</h1>
        <p>Beste ${d.referrerName},</p>
        <p><strong>${d.referredName}</strong> heeft zich via jouw persoonlijke link aangemeld als coöperant bij ${cn}.</p>
        <p>Bedankt om ${cn} te helpen groeien! Deel je link gerust verder om meer mensen te bereiken.</p>
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
