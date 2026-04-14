# Email language fallback + locale capture on registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all outgoing emails respect `User.preferredLanguage` (nl/en/fr/de) with NL as the fallback, and capture the user's current locale at registration time.

**Architecture:** Backend `EmailService` gains a `resolveRecipientLanguage(email)` helper that looks up `User.preferredLanguage` and falls back to `'nl'`. Each `sendX` method uses it (unless the caller already has a language), picks a localized subject, and forwards `language` in `templateData`. Each hardcoded-English template in `EmailProcessor.renderTemplate` is converted to a `t[lang] || t['nl']` pattern with nl/en/fr/de variants. Two frontend pages (`(auth)/register`, `onboarding`) add `preferredLanguage: useLocale()` to their POST bodies.

**Tech Stack:** NestJS 10 (backend), Next.js 14 (frontend, next-intl for i18n), Prisma 6, Jest + `@nestjs/testing` for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-14-email-language-fallback-design.md`

**Branch:** `fix/email-language-fallback` (already checked out)

---

## File structure

**Created:**
- `apps/api/src/modules/email/email.service.spec.ts` — unit tests for `resolveRecipientLanguage`.

**Modified:**
- `apps/api/src/modules/email/email.service.ts` — add `resolveRecipientLanguage`, localize subjects, forward `language` in `templateData`.
- `apps/api/src/modules/email/email.processor.ts` — convert 6 templates to `t[lang] || t['nl']`, flip fallback key from `'en'` to `'nl'` in 2 others.
- `apps/web/src/app/[locale]/(auth)/register/page.tsx` — send `preferredLanguage: locale` in POST body.
- `apps/web/src/app/[locale]/onboarding/page.tsx` — send `preferredLanguage: locale` in POST body.
- `CHANGELOG.md` — add entry under new patch version.

---

## Task 1: Add `resolveRecipientLanguage` helper with unit test

**Files:**
- Create: `apps/api/src/modules/email/email.service.spec.ts`
- Modify: `apps/api/src/modules/email/email.service.ts` (add method; import already has `PrismaService`)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/email/email.service.spec.ts` with:

```ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { EmailService } from './email.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmailService', () => {
  let service: EmailService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    emailLog: {
      create: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    jest.clearAllMocks();
  });

  describe('resolveRecipientLanguage', () => {
    it('returns the user preferredLanguage when set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('fr');
    });

    it('returns "nl" when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await (service as any).resolveRecipientLanguage('nobody@example.com');
      expect(result).toBe('nl');
    });

    it('returns "nl" when preferredLanguage is empty or null', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: null });
      const result = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result).toBe('nl');

      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: '' });
      const result2 = await (service as any).resolveRecipientLanguage('user@example.com');
      expect(result2).toBe('nl');
    });

    it('lowercases the email when looking up', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
      await (service as any).resolveRecipientLanguage('User@Example.COM');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        select: { preferredLanguage: true },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test email.service.spec -- --no-coverage`
Expected: FAIL — `service.resolveRecipientLanguage is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/modules/email/email.service.ts`, add the method inside the `EmailService` class (right before `sendWelcomeEmail` is a good spot):

```ts
private async resolveRecipientLanguage(email: string): Promise<string> {
  const user = await this.prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { preferredLanguage: true },
  });
  return user?.preferredLanguage || 'nl';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test email.service.spec -- --no-coverage`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.service.spec.ts
git commit -m "feat(email): add resolveRecipientLanguage helper with NL fallback"
```

---

## Task 2: Localize `share-purchase` subject and template (main Bronsgroen fix)

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendSharePurchaseConfirmation`, around line 103–123)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'share-purchase'`, around line 232–249)

- [ ] **Step 1: Update `sendSharePurchaseConfirmation` to resolve language, pick a localized subject, and forward `language` in templateData**

Replace the current method in `apps/api/src/modules/email/email.service.ts`:

```ts
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
```

- [ ] **Step 2: Convert the `share-purchase` template to multilingual**

In `apps/api/src/modules/email/email.processor.ts`, replace the `'share-purchase'` entry in the `templates` map:

```ts
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
```

- [ ] **Step 3: Run the API build to catch type errors**

Run: `cd apps/api && pnpm build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run existing tests to ensure nothing broke**

Run: `cd apps/api && pnpm test -- --no-coverage`
Expected: all tests pass (including the new `email.service.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize share-purchase email with NL fallback

Share purchase confirmation emails were hardcoded English, ignoring
User.preferredLanguage. Now resolves recipient language from their
user record (NL fallback) and renders subject + body in nl/en/fr/de.

Fixes Bronsgroen complaint that nl_BE browser users got English emails."
```

---

## Task 3: Localize `welcome` template

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendWelcomeEmail`, around line 93–101)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'welcome'`, around line 226–231)

- [ ] **Step 1: Update `sendWelcomeEmail` to resolve language and localize subject**

Replace the method:

```ts
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
```

- [ ] **Step 2: Convert the `welcome` template**

Replace the `'welcome'` entry in the `templates` map in `email.processor.ts`:

```ts
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
```

- [ ] **Step 3: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize welcome email with NL fallback"
```

---

## Task 4: Localize `dividend-statement` template

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendDividendStatement`, around line 158–176)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'dividend-statement'`, around line 304–310)

- [ ] **Step 1: Update `sendDividendStatement`**

Replace the method:

```ts
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
```

- [ ] **Step 2: Convert the `dividend-statement` template**

Replace the entry:

```ts
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
```

- [ ] **Step 3: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize dividend statement email with NL fallback"
```

---

## Task 5: Localize `password-reset` template

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendPasswordReset`, around line 178–186)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'password-reset'`, around line 311–318)

- [ ] **Step 1: Update `sendPasswordReset`**

Replace the method:

```ts
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
```

- [ ] **Step 2: Convert the `password-reset` template**

Replace the entry:

```ts
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
```

- [ ] **Step 3: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize password reset email with NL fallback"
```

---

## Task 6: Localize `magic-link` template

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendMagicLink`, around line 188–196)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'magic-link'`, around line 319–332)

- [ ] **Step 1: Update `sendMagicLink`**

Replace the method:

```ts
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
```

- [ ] **Step 2: Convert the `magic-link` template**

Replace the entry:

```ts
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
```

- [ ] **Step 3: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize magic link email with NL fallback"
```

---

## Task 7: Localize `gift-certificate` template

**Files:**
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendGiftCertificate`, around line 358–379)
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'gift-certificate'`, around line 397–410)

The method `sendGiftCertificate` already exists — it just needs localization added (same pattern as Tasks 2–6).

- [ ] **Step 1: Update `sendGiftCertificate` to resolve language and localize subject**

Replace the existing method:

```ts
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
```

- [ ] **Step 2: Convert the `gift-certificate` template**

Replace the entry in `email.processor.ts`:

```ts
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
```

- [ ] **Step 3: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): localize gift certificate email with NL fallback"
```

---

## Task 8: Flip fallback key from `'en'` to `'nl'` in `payment-confirmed` and `message-notification`

**Files:**
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `'payment-confirmed'` line ~286, template `'message-notification'` line ~443)
- Modify: `apps/api/src/modules/email/email.service.ts` (method `sendPaymentConfirmation`, around line 125–156 — the subject fallback there also uses `'en'`, flip to `'nl'`)

- [ ] **Step 1: In `email.service.ts`, `sendPaymentConfirmation` — flip subject fallback**

Find the current code (around line 151):

```ts
subject: subjects[lang] || subjects['en'],
```

Change to:

```ts
subject: subjects[lang] || subjects['nl'],
```

- [ ] **Step 2: In `email.processor.ts`, `'payment-confirmed'` template — flip body fallback**

Find the current code (around line 286):

```ts
const s = t[lang as keyof typeof t] || t['en'];
```

Change to:

```ts
const s = t[lang as keyof typeof t] || t['nl'];
```

- [ ] **Step 3: In `email.processor.ts`, `'message-notification'` template — confirm body fallback is already `'nl'`**

Read line ~443:

```ts
const s = t[lang as keyof typeof t] || t['nl'];
```

If it already says `t['nl']`, no change needed. If it says `t['en']`, change to `t['nl']`.

- [ ] **Step 4: Run build and tests**

Run: `cd apps/api && pnpm build && pnpm test -- --no-coverage`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/email.service.ts apps/api/src/modules/email/email.processor.ts
git commit -m "fix(email): flip payment-confirmed fallback from EN to NL"
```

---

## Task 9: Frontend — `(auth)/register/page.tsx` sends locale

**Files:**
- Modify: `apps/web/src/app/[locale]/(auth)/register/page.tsx` (around line 42–54)

- [ ] **Step 1: Import `useLocale` and add to POST body**

At the top of the file, find the existing imports from `next-intl`. Add `useLocale`:

```ts
import { useTranslations, useLocale } from 'next-intl';
```

Inside the component, after `const t = useTranslations();`, add:

```ts
const locale = useLocale();
```

In `onSubmit`, update the fetch body to include `preferredLanguage: locale`:

```ts
const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: data.email,
    password: data.password,
    preferredLanguage: locale,
  }),
});
```

- [ ] **Step 2: Run the web build to catch type errors**

Run: `cd apps/web && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/\(auth\)/register/page.tsx
git commit -m "fix(web): send current locale as preferredLanguage on register"
```

---

## Task 10: Frontend — `onboarding/page.tsx` sends locale

**Files:**
- Modify: `apps/web/src/app/[locale]/onboarding/page.tsx` (around line 92–103)

- [ ] **Step 1: Confirm `useLocale` is imported (or add it) and add to POST body**

Open the file and locate the existing imports. If `useLocale` is not imported from `next-intl`, add it:

```ts
import { useLocale } from 'next-intl';
```

Inside the component, add:

```ts
const locale = useLocale();
```

(Place it alongside other hook calls near the top of the component.)

In `onCoopSubmit`, update the fetch body to include `preferredLanguage: locale`:

```ts
const res = await fetch(`${API_URL}/auth/onboarding`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: accountValues.email,
    password: accountValues.password,
    coopName: data.coopName,
    coopSlug: data.coopSlug,
    plan,
    ...(!isFree && { billingPeriod: billing }),
    termsAccepted: accountValues.acceptTerms === true,
    preferredLanguage: locale,
  }),
});
```

- [ ] **Step 2: Run the web build**

Run: `cd apps/web && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/onboarding/page.tsx
git commit -m "fix(web): send current locale as preferredLanguage on coop onboarding"
```

---

## Task 11: Manual smoke test, CHANGELOG, PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Start dev servers and smoke-test**

Run: `pnpm dev`

With a seeded dev DB:
1. Navigate to `http://localhost:3002/nl/register`, create a new account.
2. In another terminal: `cd packages/database && pnpm db:studio`. Open `User` table, find the new user. Verify `preferredLanguage === 'nl'`.
3. Repeat for `http://localhost:3002/fr/register` → verify `preferredLanguage === 'fr'`.
4. Repeat for `http://localhost:3002/en/register` → verify `preferredLanguage === 'en'`.
5. As a NL-language admin, trigger a share-purchase registration for a shareholder whose linked user has `preferredLanguage='nl'`. Check the console/log output (emails print via SMTP_HOST unset → falls back to `sendViaPlatformSmtp` which will error; if so, temporarily set a dev SMTP or catch the HTML render by triggering a unit test of the processor). Alternative: inspect the `EmailLog` row in Prisma Studio and note `subject === 'Bevestiging van je aandelenaankoop'`.
6. Repeat for a user with `preferredLanguage='en'` → subject should be `'Share Purchase Confirmation'`.

If any step fails, stop and investigate before moving on.

- [ ] **Step 2: Update CHANGELOG.md**

Read the current top of `CHANGELOG.md` to find the latest version (e.g., `v0.7.61`). The next patch version is `v0.7.62`.

Add a new entry at the top of the changelog under the same format used by existing entries. Example:

```markdown
## v0.7.62 — 2026-04-14

### Fixed
- Emails (share purchase, welcome, dividend statement, password reset, magic link, gift certificate) now respect `User.preferredLanguage` with a Dutch fallback. Previously these templates were hardcoded English, causing nl_BE browser users (notably Bronsgroen members) to receive English emails.
- Shareholder registration and coop onboarding now persist the user's current UI locale (`nl` / `en` / `fr` / `de`) as their `preferredLanguage`.
```

- [ ] **Step 3: Commit the CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "chore: update CHANGELOG for v0.7.62"
```

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin fix/email-language-fallback
gh pr create --title "fix: email language fallback + capture locale on registration" --body "$(cat <<'EOF'
## Summary
- All user-facing email templates (share purchase, welcome, dividend statement, password reset, magic link, gift certificate) now respect `User.preferredLanguage` with a Dutch fallback. Previously these templates were hardcoded English.
- Registration and coop onboarding pages now send the current UI locale (`nl`/`en`/`fr`/`de`) as `preferredLanguage`, so new users start in the language they're browsing in.
- Fixes Bronsgroen complaint: `nl_BE` browser users were receiving English emails.

## Test plan
- [x] Unit tests for `EmailService.resolveRecipientLanguage` pass
- [x] API build + existing test suite pass
- [x] Web build passes
- [ ] Smoke test on acc: register at `/nl/register`, confirm user has `preferredLanguage='nl'`
- [ ] Smoke test on acc: trigger a share-purchase flow, confirm subject + body render in Dutch

See spec: `docs/superpowers/specs/2026-04-14-email-language-fallback-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI on the PR, then merge to main**

Run: `gh pr view --web` to open in browser and watch CI. Once CI passes and smoke-test on acc.opencoop.be is verified, merge via the UI or `gh pr merge --squash`.

- [ ] **Step 6: Tag prod release**

After merge to main, on the main branch:

```bash
git checkout main && git pull
git tag -a v0.7.62 -m "fix: email language fallback + capture locale on registration"
git push origin v0.7.62
```

Monitor the prod deploy run in GitHub Actions to completion. If it fails, fix and re-push (per memory rule).

---

## Summary of commits

By the end, the branch should have these commits (on top of the design doc commits):

1. `feat(email): add resolveRecipientLanguage helper with NL fallback`
2. `fix(email): localize share-purchase email with NL fallback`
3. `fix(email): localize welcome email with NL fallback`
4. `fix(email): localize dividend statement email with NL fallback`
5. `fix(email): localize password reset email with NL fallback`
6. `fix(email): localize magic link email with NL fallback`
7. `fix(email): localize gift certificate email with NL fallback`
8. `fix(email): flip payment-confirmed fallback from EN to NL`
9. `fix(web): send current locale as preferredLanguage on register`
10. `fix(web): send current locale as preferredLanguage on coop onboarding`
11. `chore: update CHANGELOG for v0.7.62`
