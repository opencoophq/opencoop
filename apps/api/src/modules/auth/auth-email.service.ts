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
      templateKey: 'email-verification',
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

  /**
   * Tells the current login address that a change to `newEmail` is pending.
   * Nothing changes until the link mailed to the new address is used.
   */
  async sendLoginEmailChangeNotice(oldEmail: string, newEmail: string, lang?: string) {
    const t = this.getLoginEmailChangeNoticeContent(lang, newEmail);
    const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    await this.emailService.sendPlatformEmail({
      to: oldEmail,
      subject: t.subject,
      templateKey: 'login-email-change-notice',
      text: `${t.body}\n\n${t.action}\n\n${t.footer}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } h1 { color: #1e40af; }</style></head>
        <body>
          <h1>${esc(t.subject)}</h1>
          <p>${esc(t.body)}</p>
          <p>${esc(t.action)}</p>
          <hr><p style="color: #666; font-size: 12px;">${esc(t.footer)}</p>
        </body>
        </html>
      `,
    });
  }

  private getLoginEmailChangeNoticeContent(lang: string | undefined, newEmail: string) {
    switch (lang) {
      case 'fr':
        return {
          subject: 'Changement de votre e-mail de connexion demandé',
          body: `Un administrateur OpenCoop a demandé de remplacer votre e-mail de connexion par ${newEmail}. Le changement n'a lieu que lorsque le lien envoyé à cette nouvelle adresse est utilisé. D'ici là, vous vous connectez avec cette adresse-ci.`,
          action: "Si vous n'êtes pas à l'origine de cette demande, contactez le support OpenCoop.",
          footer: 'Cet e-mail a été envoyé par OpenCoop.',
        };
      case 'de':
        return {
          subject: 'Änderung Ihrer Login-E-Mail angefordert',
          body: `Ein OpenCoop-Administrator hat angefordert, Ihre Login-E-Mail durch ${newEmail} zu ersetzen. Die Änderung gilt erst, wenn der Link an diese neue Adresse verwendet wird. Bis dahin melden Sie sich mit dieser Adresse an.`,
          action:
            'Wenn Sie diese Änderung nicht angefordert haben, wenden Sie sich an den OpenCoop-Support.',
          footer: 'Diese E-Mail wurde von OpenCoop gesendet.',
        };
      case 'en':
        return {
          subject: 'Change of your login email requested',
          body: `An OpenCoop administrator asked to replace your login email with ${newEmail}. The change happens only when the link sent to that new address is used. Until then, you sign in with this address.`,
          action: 'If you did not ask for this, contact OpenCoop support.',
          footer: 'This email was sent by OpenCoop.',
        };
      default:
        return {
          subject: 'Wijziging van uw login-e-mailadres aangevraagd',
          body: `Een OpenCoop-beheerder heeft gevraagd om uw login-e-mailadres te vervangen door ${newEmail}. De wijziging gebeurt pas wanneer de link naar dat nieuwe adres gebruikt wordt. Tot dan meldt u zich aan met dit adres.`,
          action: 'Heeft u dit niet gevraagd? Neem dan contact op met OpenCoop-support.',
          footer: 'Deze e-mail werd verzonden door OpenCoop.',
        };
    }
  }

  private getEmailVerificationContent(lang?: string) {
    switch (lang) {
      case 'fr':
        return {
          subject: 'Vérifiez votre adresse e-mail',
          heading: 'Vérifiez votre e-mail',
          body: 'Cliquez sur le bouton ci-dessous pour vérifier votre adresse e-mail :',
          button: 'Vérifier mon e-mail',
          expiry:
            "Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, vous pouvez ignorer cet e-mail.",
          footer: 'Cet e-mail a été envoyé par OpenCoop.',
        };
      case 'de':
        return {
          subject: 'E-Mail-Adresse bestätigen',
          heading: 'E-Mail bestätigen',
          body: 'Klicken Sie auf die Schaltfläche unten, um Ihre E-Mail-Adresse zu bestätigen:',
          button: 'E-Mail bestätigen',
          expiry:
            'Dieser Link ist 24 Stunden gültig. Wenn Sie kein Konto erstellt haben, können Sie diese E-Mail ignorieren.',
          footer: 'Diese E-Mail wurde von OpenCoop gesendet.',
        };
      case 'en':
        return {
          subject: 'Verify your email address',
          heading: 'Verify your email',
          body: 'Click the button below to verify your email address:',
          button: 'Verify email',
          expiry:
            "This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
          footer: 'This email was sent by OpenCoop.',
        };
      default: // nl
        return {
          subject: 'Bevestig je e-mailadres',
          heading: 'Bevestig je e-mail',
          body: 'Klik op de knop hieronder om je e-mailadres te bevestigen:',
          button: 'E-mail bevestigen',
          expiry:
            'Deze link is 24 uur geldig. Als je geen account hebt aangemaakt, kun je deze e-mail negeren.',
          footer: 'Deze e-mail is verzonden door OpenCoop.',
        };
    }
  }

  private getWaitlistEmailContent(locale?: string): {
    subject: string;
    heading: string;
    body: string;
    closing: string;
    footer: string;
  } {
    switch (locale) {
      case 'fr':
        return {
          subject: 'Merci pour votre intérêt pour OpenCoop',
          heading: 'Merci pour votre intérêt !',
          body: 'Nous avons bien reçu votre inscription.',
          closing:
            'OpenCoop est actuellement en préparation. Nous vous contacterons dès que la plateforme sera disponible.',
          footer:
            'Vous recevez cet e-mail car vous vous êtes inscrit(e) sur la liste d\'attente de <a href="https://opencoop.be">opencoop.be</a>.',
        };
      case 'de':
        return {
          subject: 'Vielen Dank für Ihr Interesse an OpenCoop',
          heading: 'Vielen Dank für Ihr Interesse!',
          body: 'Wir haben Ihre Anmeldung erhalten.',
          closing:
            'OpenCoop befindet sich derzeit in Vorbereitung. Wir werden Sie kontaktieren, sobald die Plattform verfügbar ist.',
          footer:
            'Sie erhalten diese E-Mail, weil Sie sich auf der Warteliste von <a href="https://opencoop.be">opencoop.be</a> eingetragen haben.',
        };
      case 'en':
        return {
          subject: 'Thank you for your interest in OpenCoop',
          heading: 'Thank you for your interest!',
          body: 'We have received your registration.',
          closing:
            'OpenCoop is currently being prepared. We will contact you as soon as the platform is available.',
          footer:
            'You are receiving this email because you signed up for the waitlist at <a href="https://opencoop.be">opencoop.be</a>.',
        };
      default: // nl
        return {
          subject: 'Bedankt voor je interesse in OpenCoop',
          heading: 'Bedankt voor je interesse!',
          body: 'We hebben je registratie goed ontvangen.',
          closing:
            'OpenCoop is momenteel in voorbereiding. We nemen binnenkort contact met je op zodra het platform beschikbaar is.',
          footer:
            'Je ontvangt deze e-mail omdat je je hebt ingeschreven op de wachtlijst van <a href="https://opencoop.be">opencoop.be</a>.',
        };
    }
  }

  private getWaitlistClosing(locale?: string): string {
    switch (locale) {
      case 'fr':
        return "Cordialement,<br>L'équipe OpenCoop";
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
          ignore:
            "Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.",
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
          subject: `Votre code de connexion pour ${coopName}`,
          heading: `Connexion à ${coopName}`,
          codeLine: 'Votre code de connexion : {code}',
          body: "Saisissez ce code sur la page de connexion, ou utilisez le bouton sur l'appareil où vous voulez rester connecté.",
          button: 'Se connecter',
          expiry:
            "Ce code et ce lien sont valables 10 minutes. Si vous n'avez pas demandé ceci, vous pouvez ignorer cet e-mail.",
          footer: `Cet e-mail a été envoyé par ${coopName}.`,
        };
      case 'de':
        return {
          subject: `Ihr Anmeldecode für ${coopName}`,
          heading: `Bei ${coopName} anmelden`,
          codeLine: 'Ihr Anmeldecode: {code}',
          body: 'Geben Sie diesen Code auf der Anmeldeseite ein, oder nutzen Sie die Schaltfläche auf dem Gerät, auf dem Sie angemeldet bleiben möchten.',
          button: 'Anmelden',
          expiry:
            'Dieser Code und dieser Link sind 10 Minuten gültig. Wenn Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.',
          footer: `Diese E-Mail wurde von ${coopName} gesendet.`,
        };
      case 'en':
        return {
          subject: `Your ${coopName} sign-in code`,
          heading: `Log in to ${coopName}`,
          codeLine: 'Your sign-in code: {code}',
          body: 'Enter this code on the sign-in page, or press the button on the device where you want to stay signed in.',
          button: 'Sign in',
          expiry:
            'This code and link are valid for 10 minutes. If you did not request this, you can ignore this email.',
          footer: `This email was sent by ${coopName}.`,
        };
      default: // nl
        return {
          subject: `Je inlogcode voor ${coopName}`,
          heading: `Inloggen bij ${coopName}`,
          codeLine: 'Je inlogcode: {code}',
          body: 'Vul deze code in op de inlogpagina, of gebruik de knop op het apparaat waarop je wil blijven.',
          button: 'Inloggen',
          expiry:
            'Deze code en link zijn 10 minuten geldig. Als je dit niet hebt aangevraagd, kun je deze e-mail negeren.',
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
      templateKey: 'waitlist-confirmation',
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
