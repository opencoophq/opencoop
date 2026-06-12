import { Injectable } from '@nestjs/common';
import { EmailService } from '../email/email.service';

/**
 * Transactional auth emails (verification, password reset, magic link, waitlist)
 * and their localized content. Extracted from AuthService to keep that file
 * focused on auth flow logic. AuthService delegates here; the content builders
 * for password-reset and magic-link are public because AuthService sends those
 * two emails inline (it composes the HTML itself), reusing the localized copy.
 */
@Injectable()
export class AuthEmailService {
  constructor(private emailService: EmailService) {}

  async sendVerificationEmail(email: string, token: string, lang?: string) {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
    const t = this.getEmailVerificationContent(lang);

    await this.emailService.sendPlatformEmail({
      to: email,
      subject: t.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: #1e40af; }</style></head>
        <body>
          <h1>${t.heading}</h1>
          <p>${t.body}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${t.button}
            </a>
          </p>
          <p style="color: #666; font-size: 12px;">${t.expiry}</p>
          <hr><p style="color: #666; font-size: 12px;">${t.footer}</p>
        </body>
        </html>
      `,
    });
  }

  private getEmailVerificationContent(lang?: string) {
    switch (lang) {
      case 'fr':
        return {
          subject: 'Vérifiez votre adresse e-mail',
          heading: 'Vérifiez votre e-mail',
          body: 'Cliquez sur le bouton ci-dessous pour vérifier votre adresse e-mail :',
          button: 'Vérifier mon e-mail',
          expiry: 'Ce lien expire dans 24 heures. Si vous n\'avez pas créé de compte, vous pouvez ignorer cet e-mail.',
          footer: 'Cet e-mail a été envoyé par OpenCoop.',
        };
      case 'de':
        return {
          subject: 'E-Mail-Adresse bestätigen',
          heading: 'E-Mail bestätigen',
          body: 'Klicken Sie auf die Schaltfläche unten, um Ihre E-Mail-Adresse zu bestätigen:',
          button: 'E-Mail bestätigen',
          expiry: 'Dieser Link ist 24 Stunden gültig. Wenn Sie kein Konto erstellt haben, können Sie diese E-Mail ignorieren.',
          footer: 'Diese E-Mail wurde von OpenCoop gesendet.',
        };
      case 'en':
        return {
          subject: 'Verify your email address',
          heading: 'Verify your email',
          body: 'Click the button below to verify your email address:',
          button: 'Verify email',
          expiry: 'This link expires in 24 hours. If you didn\'t create an account, you can safely ignore this email.',
          footer: 'This email was sent by OpenCoop.',
        };
      default: // nl
        return {
          subject: 'Bevestig je e-mailadres',
          heading: 'Bevestig je e-mail',
          body: 'Klik op de knop hieronder om je e-mailadres te bevestigen:',
          button: 'E-mail bevestigen',
          expiry: 'Deze link is 24 uur geldig. Als je geen account hebt aangemaakt, kun je deze e-mail negeren.',
          footer: 'Deze e-mail is verzonden door OpenCoop.',
        };
    }
  }

  private getWaitlistEmailContent(locale?: string): { subject: string; heading: string; body: string; closing: string; footer: string } {
    switch (locale) {
      case 'fr':
        return {
          subject: 'Merci pour votre intérêt pour OpenCoop',
          heading: 'Merci pour votre intérêt !',
          body: 'Nous avons bien reçu votre inscription.',
          closing: 'OpenCoop est actuellement en préparation. Nous vous contacterons dès que la plateforme sera disponible.',
          footer: 'Vous recevez cet e-mail car vous vous êtes inscrit(e) sur la liste d\'attente de <a href="https://opencoop.be">opencoop.be</a>.',
        };
      case 'de':
        return {
          subject: 'Vielen Dank für Ihr Interesse an OpenCoop',
          heading: 'Vielen Dank für Ihr Interesse!',
          body: 'Wir haben Ihre Anmeldung erhalten.',
          closing: 'OpenCoop befindet sich derzeit in Vorbereitung. Wir werden Sie kontaktieren, sobald die Plattform verfügbar ist.',
          footer: 'Sie erhalten diese E-Mail, weil Sie sich auf der Warteliste von <a href="https://opencoop.be">opencoop.be</a> eingetragen haben.',
        };
      case 'en':
        return {
          subject: 'Thank you for your interest in OpenCoop',
          heading: 'Thank you for your interest!',
          body: 'We have received your registration.',
          closing: 'OpenCoop is currently being prepared. We will contact you as soon as the platform is available.',
          footer: 'You are receiving this email because you signed up for the waitlist at <a href="https://opencoop.be">opencoop.be</a>.',
        };
      default: // nl
        return {
          subject: 'Bedankt voor je interesse in OpenCoop',
          heading: 'Bedankt voor je interesse!',
          body: 'We hebben je registratie goed ontvangen.',
          closing: 'OpenCoop is momenteel in voorbereiding. We nemen binnenkort contact met je op zodra het platform beschikbaar is.',
          footer: 'Je ontvangt deze e-mail omdat je je hebt ingeschreven op de wachtlijst van <a href="https://opencoop.be">opencoop.be</a>.',
        };
    }
  }

  private getWaitlistClosing(locale?: string): string {
    switch (locale) {
      case 'fr':
        return 'Cordialement,<br>L\'équipe OpenCoop';
      case 'de':
        return 'Mit freundlichen Grüßen,<br>Das OpenCoop-Team';
      case 'en':
        return 'Kind regards,<br>The OpenCoop team';
      default:
        return 'Met vriendelijke groeten,<br>Het OpenCoop team';
    }
  }

  getPasswordResetContent(lang?: string) {
    switch (lang) {
      case 'fr':
        return {
          subject: 'Réinitialisation de votre mot de passe',
          heading: 'Réinitialisation du mot de passe',
          body: 'Cliquez sur le lien ci-dessous pour réinitialiser votre mot de passe :',
          ignore: 'Si vous n\'avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.',
          expiry: 'Ce lien expire dans 1 heure.',
          footer: 'Cet e-mail a été envoyé par OpenCoop.',
        };
      case 'de':
        return {
          subject: 'Passwort zurücksetzen',
          heading: 'Passwort zurücksetzen',
          body: 'Klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:',
          ignore: 'Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
          expiry: 'Dieser Link ist 1 Stunde gültig.',
          footer: 'Diese E-Mail wurde von OpenCoop gesendet.',
        };
      case 'en':
        return {
          subject: 'Password Reset Request',
          heading: 'Password Reset Request',
          body: 'Click the link below to reset your password:',
          ignore: 'If you did not request this, please ignore this email.',
          expiry: 'This link will expire in 1 hour.',
          footer: 'This email was sent by OpenCoop.',
        };
      default: // nl
        return {
          subject: 'Wachtwoord opnieuw instellen',
          heading: 'Wachtwoord opnieuw instellen',
          body: 'Klik op de onderstaande link om je wachtwoord opnieuw in te stellen:',
          ignore: 'Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.',
          expiry: 'Deze link is 1 uur geldig.',
          footer: 'Deze e-mail is verzonden door OpenCoop.',
        };
    }
  }

  getMagicLinkContent(lang?: string, coopName = 'OpenCoop') {
    switch (lang) {
      case 'fr':
        return {
          subject: 'Votre lien de connexion',
          heading: `Connexion à ${coopName}`,
          body: 'Cliquez sur le bouton ci-dessous pour vous connecter :',
          button: 'Se connecter',
          expiry: 'Ce lien expire dans 15 minutes. Si vous n\'avez pas demandé ce lien, vous pouvez ignorer cet e-mail.',
          footer: `Cet e-mail a été envoyé par ${coopName}.`,
        };
      case 'de':
        return {
          subject: 'Ihr Login-Link',
          heading: `Bei ${coopName} anmelden`,
          body: 'Klicken Sie auf die Schaltfläche unten, um sich anzumelden:',
          button: 'Anmelden',
          expiry: 'Dieser Link ist 15 Minuten gültig. Wenn Sie diesen Link nicht angefordert haben, können Sie diese E-Mail ignorieren.',
          footer: `Diese E-Mail wurde von ${coopName} gesendet.`,
        };
      case 'en':
        return {
          subject: 'Your Login Link',
          heading: `Login to ${coopName}`,
          body: 'Click the button below to log in:',
          button: 'Log In',
          expiry: 'This link expires in 15 minutes. If you didn\'t request this, you can safely ignore this email.',
          footer: `This email was sent by ${coopName}.`,
        };
      default: // nl
        return {
          subject: 'Je inloglink',
          heading: `Inloggen bij ${coopName}`,
          body: 'Klik op de knop hieronder om in te loggen:',
          button: 'Inloggen',
          expiry: 'Deze link is 15 minuten geldig. Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.',
          footer: `Deze e-mail is verzonden door ${coopName}.`,
        };
    }
  }

  async sendWaitlistConfirmationEmail(email: string, locale?: string) {
    const content = this.getWaitlistEmailContent(locale);
    const sign = this.getWaitlistClosing(locale);

    await this.emailService.sendPlatformEmail({
      to: email,
      subject: content.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            h1 { color: #1e40af; font-size: 24px; }
            .footer { color: #666; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px; }
          </style>
        </head>
        <body>
          <h1>${content.heading}</h1>
          <p>${content.body}</p>
          <p>${content.closing}</p>
          <p>${sign}</p>
          <div class="footer">
            <p>${content.footer}</p>
          </div>
        </body>
        </html>
      `,
    });
  }
}
