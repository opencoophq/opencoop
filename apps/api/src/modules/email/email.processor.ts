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
            title: 'Je bestelling is bevestigd',
            dear: `Beste ${d.shareholderName},`,
            intro: `Bedankt voor je bestelling bij ${cn}. We hebben deze goed ontvangen — je hoeft niets meer te doen op onze website. Onderstaande gegevens heb je nodig om het bedrag over te schrijven via je bank-app.`,
            orderTitle: 'Je bestelling',
            shareClass: 'Aandelenklasse',
            quantity: 'Aantal',
            totalAmount: 'Totaalbedrag',
            paymentDetailsTitle: 'Betalingsgegevens',
            iban: 'IBAN',
            ogm: 'Gestructureerde mededeling',
            amount: 'Bedrag',
            beneficiary: 'Begunstigde',
            nextTitle: 'Wat gebeurt er nu?',
            step1: 'Je bestelling is geregistreerd',
            step2: 'Schrijf het bedrag over via je bank-app met de bovenstaande gegevens',
            step3: `Je ontvangt een tweede e-mail zodra we je betaling gematcht hebben (doorgaans binnen 1 à 2 werkdagen). Pas daarna zijn je aandelen actief.`,
            noHaste: 'Er is geen haast bij — je kunt nog steeds betalen wanneer het jou uitkomt.',
            thanks: `Bedankt om te investeren in ${cn}!`,
          },
          en: {
            title: 'Your order is confirmed',
            dear: `Dear ${d.shareholderName},`,
            intro: `Thank you for your order with ${cn}. We've received it — there's nothing more to do on our website. Use the details below to transfer the amount via your banking app.`,
            orderTitle: 'Your order',
            shareClass: 'Share class',
            quantity: 'Quantity',
            totalAmount: 'Total amount',
            paymentDetailsTitle: 'Payment details',
            iban: 'IBAN',
            ogm: 'Structured communication',
            amount: 'Amount',
            beneficiary: 'Beneficiary',
            nextTitle: "What happens next?",
            step1: 'Your order is recorded',
            step2: 'Transfer the amount via your banking app using the details above',
            step3: `You'll get a second email once we've matched your payment (usually within 1–2 business days). Only then are your shares active.`,
            noHaste: "No rush — you can still pay whenever it suits you.",
            thanks: `Thank you for investing in ${cn}!`,
          },
          fr: {
            title: 'Votre commande est confirmée',
            dear: `Cher/Chère ${d.shareholderName},`,
            intro: `Merci pour votre commande auprès de ${cn}. Nous l'avons bien reçue — vous n'avez plus rien à faire sur notre site. Utilisez les informations ci-dessous pour effectuer le virement via votre application bancaire.`,
            orderTitle: 'Votre commande',
            shareClass: "Classe d'actions",
            quantity: 'Quantité',
            totalAmount: 'Montant total',
            paymentDetailsTitle: 'Détails de paiement',
            iban: 'IBAN',
            ogm: 'Communication structurée',
            amount: 'Montant',
            beneficiary: 'Bénéficiaire',
            nextTitle: 'Et maintenant ?',
            step1: 'Votre commande est enregistrée',
            step2: 'Effectuez le virement via votre application bancaire avec les informations ci-dessus',
            step3: `Vous recevrez un second e-mail dès que nous aurons réconcilié votre paiement (généralement sous 1 à 2 jours ouvrables). Vos actions seront alors actives.`,
            noHaste: 'Pas de précipitation — vous pouvez encore payer quand cela vous convient.',
            thanks: `Merci d'investir dans ${cn} !`,
          },
          de: {
            title: 'Ihre Bestellung ist bestätigt',
            dear: `Liebe/r ${d.shareholderName},`,
            intro: `Vielen Dank für Ihre Bestellung bei ${cn}. Wir haben sie erhalten — auf unserer Website müssen Sie nichts weiter tun. Mit den untenstehenden Daten überweisen Sie den Betrag über Ihre Banking-App.`,
            orderTitle: 'Ihre Bestellung',
            shareClass: 'Anteilsklasse',
            quantity: 'Anzahl',
            totalAmount: 'Gesamtbetrag',
            paymentDetailsTitle: 'Zahlungsdetails',
            iban: 'IBAN',
            ogm: 'Strukturierte Mitteilung',
            amount: 'Betrag',
            beneficiary: 'Empfänger',
            nextTitle: 'Wie geht es weiter?',
            step1: 'Ihre Bestellung ist erfasst',
            step2: 'Überweisen Sie den Betrag über Ihre Banking-App mit den obigen Angaben',
            step3: `Sobald wir Ihre Zahlung zugeordnet haben (in der Regel innerhalb von 1–2 Werktagen), erhalten Sie eine zweite E-Mail. Erst dann sind Ihre Anteile aktiv.`,
            noHaste: 'Kein Stress — Sie können auch später zahlen, wann es Ihnen passt.',
            thanks: `Vielen Dank für Ihre Investition in ${cn}!`,
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        const amount = (d.totalAmount as number).toFixed(2);
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.intro}</p>

    <h2>${s.orderTitle}</h2>
    <ul>
      <li>${s.shareClass}: ${d.shareClassName}</li>
      <li>${s.quantity}: ${d.quantity}</li>
      <li>${s.totalAmount}: €${amount}</li>
    </ul>

    ${d.bankIban || d.ogmCode ? `
    <h2>${s.paymentDetailsTitle}</h2>
    <p>${s.beneficiary}: <strong>${cn}</strong></p>
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
        const s = t[lang as keyof typeof t] || t['nl'];
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
      'magic-link': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: 'Inloggen bij OpenCoop',
            click: 'Klik op de knop hieronder om in te loggen:',
            button: 'Inloggen',
            expires: 'Deze link vervalt binnen 15 minuten. Als je dit niet hebt aangevraagd, kan je deze e-mail veilig negeren.',
          },
          en: {
            title: 'Login to OpenCoop',
            click: 'Click the button below to log in:',
            button: 'Log In',
            expires: "This link expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
          },
          fr: {
            title: 'Connexion à OpenCoop',
            click: 'Cliquez sur le bouton ci-dessous pour vous connecter :',
            button: 'Se connecter',
            expires: "Ce lien expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail en toute sécurité.",
          },
          de: {
            title: 'Anmeldung bei OpenCoop',
            click: 'Klicken Sie auf die Schaltfläche unten, um sich anzumelden:',
            button: 'Anmelden',
            expires: 'Dieser Link läuft in 15 Minuten ab. Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
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
      'gift-certificate': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const t = {
          nl: {
            title: 'Je cadeaubon',
            dear: `Beste ${d.buyerName},`,
            thanks: `Bedankt voor het aankopen van een cadeaubon bij ${cn}!`,
            received: 'Je betaling is ontvangen en de cadeaubon is als bijlage toegevoegd.',
            shareClass: 'Aandelenklasse',
            quantity: 'Aantal',
            totalValue: 'Totale waarde',
            giftCode: 'Cadeaucode',
            share: 'Deel de cadeaubon met de ontvanger. Ze kunnen de code of QR-code gebruiken om hun aandelen op te vragen.',
            thanksEnd: `Bedankt om aandeelhouder te zijn van ${cn}!`,
          },
          en: {
            title: 'Your Gift Certificate',
            dear: `Dear ${d.buyerName},`,
            thanks: `Thank you for purchasing a gift certificate at ${cn}!`,
            received: 'Your payment has been received and the gift certificate is attached to this email.',
            shareClass: 'Share Class',
            quantity: 'Quantity',
            totalValue: 'Total Value',
            giftCode: 'Gift code',
            share: 'Share this certificate with the recipient. They can use the code or QR code to claim their shares.',
            thanksEnd: `Thank you for being a shareholder of ${cn}!`,
          },
          fr: {
            title: 'Votre bon cadeau',
            dear: `Cher/Chère ${d.buyerName},`,
            thanks: `Merci d'avoir acheté un bon cadeau chez ${cn} !`,
            received: 'Votre paiement a été reçu et le bon cadeau est joint à cet e-mail.',
            shareClass: "Classe d'actions",
            quantity: 'Quantité',
            totalValue: 'Valeur totale',
            giftCode: 'Code cadeau',
            share: 'Partagez ce bon avec le destinataire. Il peut utiliser le code ou le QR code pour réclamer ses actions.',
            thanksEnd: `Merci d'être actionnaire de ${cn} !`,
          },
          de: {
            title: 'Ihr Geschenkgutschein',
            dear: `Liebe/r ${d.buyerName},`,
            thanks: `Vielen Dank für den Kauf eines Geschenkgutscheins bei ${cn}!`,
            received: 'Ihre Zahlung wurde erhalten und der Geschenkgutschein ist dieser E-Mail beigefügt.',
            shareClass: 'Anteilsklasse',
            quantity: 'Anzahl',
            totalValue: 'Gesamtwert',
            giftCode: 'Geschenkcode',
            share: 'Teilen Sie diesen Gutschein mit dem Empfänger. Er kann den Code oder QR-Code verwenden, um seine Anteile einzulösen.',
            thanksEnd: `Vielen Dank, dass Sie Anteilseigner von ${cn} sind!`,
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.thanks}</p>
    <p>${s.received}</p>
    <ul>
      <li>${s.shareClass}: ${d.shareClassName}</li>
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
      'meeting-convocation': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const customBody = (d.customBody as string) || '';
        const t = {
          nl: {
            title: 'Oproeping Algemene Vergadering',
            dear: `Beste ${d.shareholderName},`,
            intro: `U wordt uitgenodigd voor de <strong>${d.meetingTitle}</strong> op <strong>${d.meetingDate}</strong> te <strong>${d.meetingLocation || 'nader te bepalen'}</strong>.`,
            agendaTitle: 'Agenda',
            cta: 'Reageer op de oproeping',
            proxy: 'Klik op de knop hierboven om aan te geven of u aanwezig zult zijn, niet aanwezig zult zijn, of om uw stem te delegeren aan een andere aandeelhouder (volmacht).',
            attachment: 'In bijlage vindt u de officiële oproeping als PDF.',
            closing: 'Met vriendelijke groet,',
          },
          en: {
            title: 'Notice of General Meeting',
            dear: `Dear ${d.shareholderName},`,
            intro: `You are invited to the <strong>${d.meetingTitle}</strong> on <strong>${d.meetingDate}</strong> at <strong>${d.meetingLocation || 'to be determined'}</strong>.`,
            agendaTitle: 'Agenda',
            cta: 'Respond to the notice',
            proxy: 'Click the button above to indicate whether you will attend, will not attend, or to delegate your vote to another shareholder (proxy).',
            attachment: 'The official notice is attached as a PDF.',
            closing: 'Kind regards,',
          },
          fr: {
            title: "Convocation à l'Assemblée Générale",
            dear: `Cher/Chère ${d.shareholderName},`,
            intro: `Vous êtes invité(e) à <strong>${d.meetingTitle}</strong> le <strong>${d.meetingDate}</strong> à <strong>${d.meetingLocation || 'à déterminer'}</strong>.`,
            agendaTitle: 'Ordre du jour',
            cta: 'Répondre à la convocation',
            proxy: "Cliquez sur le bouton ci-dessus pour indiquer si vous serez présent(e), absent(e), ou pour déléguer votre voix à un autre actionnaire (procuration).",
            attachment: "La convocation officielle est jointe en PDF.",
            closing: 'Cordialement,',
          },
          de: {
            title: 'Einladung zur Generalversammlung',
            dear: `Liebe/r ${d.shareholderName},`,
            intro: `Sie sind eingeladen zur <strong>${d.meetingTitle}</strong> am <strong>${d.meetingDate}</strong> in <strong>${d.meetingLocation || 'noch zu bestimmen'}</strong>.`,
            agendaTitle: 'Tagesordnung',
            cta: 'Auf die Einladung antworten',
            proxy: 'Klicken Sie oben auf die Schaltfläche, um anzugeben, ob Sie teilnehmen werden, nicht teilnehmen werden, oder Ihre Stimme an einen anderen Anteilseigner zu delegieren (Vollmacht).',
            attachment: 'Die offizielle Einladung ist als PDF beigefügt.',
            closing: 'Mit freundlichen Grüßen,',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        const items = (d.agendaItems as Array<{ order: number; title: string; description?: string }>) || [];
        const agendaHtml = items
          .sort((a, b) => a.order - b.order)
          .map((i) => `<li><strong>${i.title}</strong>${i.description ? `<br><span style="color:#555;">${i.description}</span>` : ''}</li>`)
          .join('');
        const ctaButton = `
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.rsvpUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
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
            .replaceAll('{{shareholderName}}', String(d.shareholderName ?? ''))
            .replaceAll('{{meetingTitle}}', String(d.meetingTitle ?? ''))
            .replaceAll('{{meetingDate}}', String(d.meetingDate ?? ''))
            .replaceAll('{{meetingLocation}}', String(d.meetingLocation ?? ''))
            .replaceAll('{{agendaList}}', agendaHtml ? `<ol>${agendaHtml}</ol>` : '');
          const hasRsvpLink = /rsvpurl|\/meetings\/rsvp\//i.test(substituted);
          return substituted + (hasRsvpLink ? '' : ctaButton);
        }

        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.intro}</p>
          <h2>${s.agendaTitle}</h2>
          <ol>${agendaHtml}</ol>
          ${ctaButton}
          <p>${s.proxy}</p>
          <p style="color: #666; font-size: 12px;">${s.attachment}</p>
          <p>${s.closing}</p>
        `;
      },
      'meeting-rsvp-confirmation': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const status = (d.rsvpStatus as string) || 'ATTENDING';
        const delegateName = (d.delegateName as string) || '';
        const t = {
          nl: {
            title: 'Bevestiging van uw RSVP',
            dear: `Beste ${d.shareholderName},`,
            meeting: `Vergadering: <strong>${d.meetingTitle}</strong> op <strong>${d.meetingDate}</strong>.`,
            attending: 'Bedankt voor uw bevestiging. We kijken uit naar uw aanwezigheid.',
            absent: 'We hebben genoteerd dat u niet aanwezig kunt zijn.',
            proxy: `U heeft uw stem gedelegeerd aan <strong>${delegateName}</strong>.`,
            change: 'Wijzig uw RSVP',
          },
          en: {
            title: 'RSVP Confirmation',
            dear: `Dear ${d.shareholderName},`,
            meeting: `Meeting: <strong>${d.meetingTitle}</strong> on <strong>${d.meetingDate}</strong>.`,
            attending: 'Thank you for confirming. We look forward to your attendance.',
            absent: 'We have noted that you will not be able to attend.',
            proxy: `You have delegated your vote to <strong>${delegateName}</strong>.`,
            change: 'Change your RSVP',
          },
          fr: {
            title: 'Confirmation de votre RSVP',
            dear: `Cher/Chère ${d.shareholderName},`,
            meeting: `Réunion : <strong>${d.meetingTitle}</strong> le <strong>${d.meetingDate}</strong>.`,
            attending: 'Merci pour votre confirmation. Nous attendons votre présence.',
            absent: 'Nous avons noté que vous ne pourrez pas être présent(e).',
            proxy: `Vous avez délégué votre vote à <strong>${delegateName}</strong>.`,
            change: 'Modifier votre RSVP',
          },
          de: {
            title: 'Bestätigung Ihrer RSVP',
            dear: `Liebe/r ${d.shareholderName},`,
            meeting: `Versammlung: <strong>${d.meetingTitle}</strong> am <strong>${d.meetingDate}</strong>.`,
            attending: 'Vielen Dank für Ihre Bestätigung. Wir freuen uns auf Ihre Teilnahme.',
            absent: 'Wir haben vermerkt, dass Sie nicht teilnehmen können.',
            proxy: `Sie haben Ihre Stimme an <strong>${delegateName}</strong> delegiert.`,
            change: 'RSVP ändern',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
        const body = status === 'PROXY' ? s.proxy : status === 'ABSENT' ? s.absent : s.attending;
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p>${s.meeting}</p>
          <p>${body}</p>
          ${d.rsvpUrl ? `
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.rsvpUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${s.change}
            </a>
          </p>
          ` : ''}
        `;
      },
      'meeting-reminder': (d, _cn) => {
        const lang = (d.language as string) || 'nl';
        const days = (d.daysUntil as number) ?? 0;
        const t = {
          nl: {
            title: 'Herinnering: Algemene Vergadering',
            dear: `Beste ${d.shareholderName},`,
            body: `Herinnering: de <strong>${d.meetingTitle}</strong> vindt plaats over <strong>${days}</strong> dag(en) op <strong>${d.meetingDate}</strong>. U heeft nog niet geantwoord. Gelieve te bevestigen:`,
            cta: 'RSVP hier',
          },
          en: {
            title: 'Reminder: General Meeting',
            dear: `Dear ${d.shareholderName},`,
            body: `Reminder: the <strong>${d.meetingTitle}</strong> is in <strong>${days}</strong> day(s) on <strong>${d.meetingDate}</strong>. You haven't yet responded. Please RSVP:`,
            cta: 'RSVP here',
          },
          fr: {
            title: 'Rappel : Assemblée Générale',
            dear: `Cher/Chère ${d.shareholderName},`,
            body: `Rappel : <strong>${d.meetingTitle}</strong> aura lieu dans <strong>${days}</strong> jour(s), le <strong>${d.meetingDate}</strong>. Vous n'avez pas encore répondu. Veuillez confirmer :`,
            cta: 'Répondre ici',
          },
          de: {
            title: 'Erinnerung: Generalversammlung',
            dear: `Liebe/r ${d.shareholderName},`,
            body: `Erinnerung: die <strong>${d.meetingTitle}</strong> findet in <strong>${days}</strong> Tag(en) am <strong>${d.meetingDate}</strong> statt. Sie haben noch nicht geantwortet. Bitte bestätigen Sie:`,
            cta: 'Hier antworten',
          },
        };
        const s = t[lang as keyof typeof t] || t['nl'];
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
