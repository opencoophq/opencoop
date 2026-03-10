# Terms & Conditions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add legally trackable T&C and privacy policy acceptance to both the coop onboarding flow and shareholder registration flow.

**Architecture:** Add nullable acceptance fields to existing Prisma models (User, Registration). Create static i18n pages for terms and privacy policy. Wire frontend checkboxes to backend validation with server-side version stamping.

**Tech Stack:** NestJS, Prisma, Next.js 14, next-intl, Zod, react-hook-form

**Spec:** `docs/superpowers/specs/2026-03-10-terms-and-conditions-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/shared/src/legal.ts` | Version constants (`TERMS_VERSION`, `PRIVACY_VERSION`) |
| Modify | `packages/database/prisma/schema.prisma` | Add acceptance fields to User and Registration models |
| Create | `apps/web/src/app/[locale]/terms/page.tsx` | Static terms page with i18n |
| Create | `apps/web/src/app/[locale]/privacy/page.tsx` | Static privacy policy page with i18n |
| Modify | `apps/web/messages/en.json` | English translations for legal text + new keys |
| Modify | `apps/web/messages/nl.json` | Dutch translations |
| Modify | `apps/web/messages/fr.json` | French translations |
| Modify | `apps/web/messages/de.json` | German translations |
| Modify | `apps/api/src/modules/auth/dto/onboarding.dto.ts` | Add `termsAccepted` field |
| Modify | `apps/api/src/modules/auth/auth.service.ts` | Store terms acceptance on User |
| Modify | `apps/web/src/app/[locale]/onboarding/page.tsx` | Add T&C checkbox to Step 0 |
| Modify | `apps/api/src/modules/coops/dto/public-register.dto.ts` | Add acceptance fields |
| Modify | `apps/api/src/modules/channels/channels.service.ts` | Validate & store terms acceptance |
| Modify | `apps/api/src/modules/registrations/registrations.service.ts` | Accept & persist terms fields in createBuy |
| Modify | `apps/web/src/components/coop-register-content.tsx` | Wire terms checkbox + add privacy checkbox |

---

## Chunk 1: Database & Shared Constants

### Task 1: Create shared legal constants

**Files:**
- Create: `packages/shared/src/legal.ts`
- Modify: `packages/shared/src/index.ts` (add export)

- [ ] **Step 1: Create the constants file**

```typescript
// packages/shared/src/legal.ts
export const TERMS_VERSION = '2026-03-10';
export const PRIVACY_VERSION = '2026-03-10';
```

- [ ] **Step 2: Export from shared package index**

Add to `packages/shared/src/index.ts`:

```typescript
export { TERMS_VERSION, PRIVACY_VERSION } from './legal';
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/legal.ts packages/shared/src/index.ts
git commit -m "feat: add shared legal version constants"
```

### Task 2: Add acceptance fields to Prisma schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma:210-247` (User model)
- Modify: `packages/database/prisma/schema.prisma:499-564` (Registration model)

- [ ] **Step 1: Add fields to User model**

After the `appleId` field (line 232) and before the `// Relations` comment (line 234), add:

```prisma
  // Terms acceptance
  termsAcceptedAt  DateTime?
  termsVersion     String?
```

- [ ] **Step 2: Add fields to Registration model**

After the `isGift` block (line 544, after `giftClaimedByShareholder` relation) and before `// Relations` (line 547), add:

```prisma
  // Terms & privacy acceptance
  coopTermsAcceptedAt DateTime?
  coopTermsVersion    String?   // termsUrl at time of acceptance
  privacyAcceptedAt   DateTime?
  privacyVersion      String?
```

- [ ] **Step 3: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Prisma client regenerates successfully with new fields.

- [ ] **Step 4: Create migration**

Run: `cd packages/database && npx prisma migrate dev --name add-terms-acceptance-fields`
Expected: Migration created. Review the SQL to confirm it only adds nullable columns.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat: add terms acceptance fields to User and Registration models"
```

---

## Chunk 2: Static Legal Pages & Translations

### Task 3: Add translation keys for legal pages

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

- [ ] **Step 1: Add legal page translation keys to all 4 locale files**

Add a `"legal"` top-level key to each locale file with the following structure. The actual legal text content should be written in the appropriate language for each file.

```json
{
  "legal": {
    "termsTitle": "Terms & Conditions",
    "privacyTitle": "Privacy Policy",
    "lastUpdated": "Last updated: {date}",
    "acceptTermsAndConditions": "I accept the {link}",
    "termsAndConditionsLink": "Terms & Conditions",
    "acceptPrivacyPolicy": "I accept the {link}",
    "privacyPolicyLink": "Privacy Policy",
    "termsContent": "... full legal text ...",
    "privacyContent": "... full legal text ..."
  }
}
```

Note: `termsContent` and `privacyContent` hold the complete legal text per language. Use `\n\n` for paragraph breaks. The implementing agent should write reasonable placeholder legal text for a Belgian cooperative SaaS platform (OpenCoop), covering:

**Terms & Conditions** — account creation, platform usage, subscription plans, data handling responsibilities (coop is data controller, OpenCoop is processor), Belgian law jurisdiction, liability limitations, termination.

**Privacy Policy** — data collected, purposes, legal basis (GDPR Art. 6), data retention, rights (access, rectification, erasure, portability), sub-processors, cookies (basic), contact details (OpenCoop, support@opencoop.be).

- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add legal page translations in all 4 languages"
```

### Task 4: Create Terms & Conditions page

**Files:**
- Create: `apps/web/src/app/[locale]/terms/page.tsx`

Follow the same pattern as `apps/web/src/app/[locale]/pricing/page.tsx` — server component with `generateStaticParams`, `generateMetadata`, and `getTranslations`.

- [ ] **Step 1: Create the terms page**

```tsx
// apps/web/src/app/[locale]/terms/page.tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { TERMS_VERSION } from '@opencoop/shared';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const revalidate = 3600;

const BASE_URL = 'https://opencoop.be';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${BASE_URL}/${loc}/terms`;
  }

  return {
    title: t('termsTitle'),
    alternates: {
      languages,
      canonical: `${BASE_URL}/${locale}/terms`,
    },
  };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold mb-2">{t('termsTitle')}</h1>
      <p className="text-muted-foreground mb-8">
        {t('lastUpdated', { date: TERMS_VERSION })}
      </p>
      <div className="prose dark:prose-invert max-w-none whitespace-pre-line">
        {t('termsContent')}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run: `pnpm dev` (if not already running)
Navigate to: `http://localhost:3002/en/terms`
Expected: Terms page renders with English legal text and "Last updated: 2026-03-10".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\[locale\]/terms/
git commit -m "feat: add terms and conditions page"
```

### Task 5: Create Privacy Policy page

**Files:**
- Create: `apps/web/src/app/[locale]/privacy/page.tsx`

- [ ] **Step 1: Create the privacy page**

Same structure as the terms page but using `privacyTitle` and `privacyContent` translation keys, and `PRIVACY_VERSION` constant. Update the metadata canonical/alternates to use `/privacy`.

- [ ] **Step 2: Verify the page renders**

Navigate to: `http://localhost:3002/en/privacy`
Expected: Privacy policy page renders with English legal text.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\[locale\]/privacy/
git commit -m "feat: add privacy policy page"
```

---

## Chunk 3: Onboarding Flow (Platform T&C)

### Task 6: Add `termsAccepted` to onboarding DTO

**Files:**
- Modify: `apps/api/src/modules/auth/dto/onboarding.dto.ts:1-52`

- [ ] **Step 1: Add the field**

Add after the `preferredLanguage` field (line 51):

```typescript
  @ApiProperty({ example: true, description: 'Must accept platform terms and conditions' })
  @IsBoolean()
  termsAccepted: boolean;
```

Add `IsBoolean` to the imports on line 1.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/auth/dto/onboarding.dto.ts
git commit -m "feat: add termsAccepted field to onboarding DTO"
```

### Task 7: Store terms acceptance in auth service

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:168-292`

- [ ] **Step 1: Add validation and storage**

At the top of the `onboard()` method (after line 169, the email normalization), add validation:

```typescript
    if (!onboardingDto.termsAccepted) {
      throw new BadRequestException('You must accept the terms and conditions');
    }
```

Add `BadRequestException` to the `@nestjs/common` import at the top of the file if not already imported.

In the `tx.user.create` call (lines 200-210), add to the `data` object:

```typescript
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
```

Add the import at the top of the file:

```typescript
import { TERMS_VERSION } from '@opencoop/shared';
```

- [ ] **Step 2: Verify the API rejects missing terms**

Run: Send a POST to `/auth/onboarding` without `termsAccepted` field.
Expected: 400 Bad Request.

Run: Send a POST with `termsAccepted: false`.
Expected: 400 Bad Request with message "You must accept the terms and conditions".

Run: Send a POST with `termsAccepted: true` and valid data.
Expected: 201 with normal onboarding response.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts
git commit -m "feat: validate and store terms acceptance during onboarding"
```

### Task 8: Add T&C checkbox to onboarding frontend

**Files:**
- Modify: `apps/web/src/app/[locale]/onboarding/page.tsx`

- [ ] **Step 1: Add `acceptTerms` to account form schema**

Modify the `accountSchema` (line 42-51). Add `acceptTerms` to the `z.object`:

```typescript
  const accountSchema = z
    .object({
      email: z.string().min(1, t('validation.emailRequired')).email(t('validation.emailInvalid')),
      password: z.string().min(8, t('validation.passwordMin')),
      confirmPassword: z.string(),
      acceptTerms: z.literal(true, {
        errorMap: () => ({ message: t('validation.acceptTerms') }),
      }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('validation.passwordMismatch'),
      path: ['confirmPassword'],
    });
```

Update default values (line 66):

```typescript
    defaultValues: { email: '', password: '', confirmPassword: '', acceptTerms: undefined as never },
```

- [ ] **Step 2: Add checkbox UI to Step 0**

In the Step 0 render section (around line 172-231), add the checkbox before the submit button.

First, add these imports to the top of the file:

```typescript
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';
```

(`Label` is already imported. `Checkbox` is NOT currently imported in this file.)

Then add a second translations hook for the `legal` namespace (the page already uses `const t = useTranslations('onboarding')` scoped to onboarding):

```typescript
const tLegal = useTranslations('legal');
```

Then add the checkbox JSX:

```tsx
<div className="flex items-start space-x-2 mt-4">
  <Checkbox
    id="acceptTerms"
    checked={accountForm.watch('acceptTerms') || false}
    onCheckedChange={(checked) =>
      accountForm.setValue('acceptTerms', checked === true ? true : undefined as never, { shouldValidate: true })
    }
  />
  <Label htmlFor="acceptTerms" className="text-sm">
    {tLegal.rich('acceptTermsAndConditions', {
      link: (chunks) => (
        <Link href="/terms" target="_blank" className="underline hover:no-underline">
          {chunks}
        </Link>
      ),
    })}
  </Label>
</div>
```

The `legal.acceptTermsAndConditions` key uses the top-level `legal` namespace (not nested under `onboarding`), accessed via `tLegal`.

- [ ] **Step 3: Include `termsAccepted` in the API payload**

In `onCoopSubmit` (line 81-99), add `termsAccepted` to the JSON body. The value comes from the account form:

```typescript
      body: JSON.stringify({
        email: accountValues.email,
        password: accountValues.password,
        coopName: data.coopName,
        coopSlug: data.coopSlug,
        plan,
        ...(!isFree && { billingPeriod: billing }),
        termsAccepted: accountValues.acceptTerms === true,
      }),
```

- [ ] **Step 4: Add validation translation key**

Add to all 4 locale files under `onboarding.validation`:

```json
"acceptTerms": "You must accept the terms and conditions"
```

- [ ] **Step 5: Verify end-to-end**

1. Navigate to `http://localhost:3002/en/onboarding?plan=free`
2. Fill in email and password
3. Try to proceed without checking the checkbox → should show validation error
4. Check the checkbox → should be able to proceed
5. Complete onboarding → verify in database that `termsAcceptedAt` and `termsVersion` are set on the User record

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\[locale\]/onboarding/page.tsx apps/web/messages/
git commit -m "feat: add terms acceptance checkbox to onboarding flow"
```

---

## Chunk 4: Shareholder Registration Flow (Coop T&C + Privacy Policy)

### Task 9: Add acceptance fields to registration DTO

**Files:**
- Modify: `apps/api/src/modules/coops/dto/public-register.dto.ts:1-97`

- [ ] **Step 1: Add fields to the DTO**

Add after the `isGift` field (line 96):

```typescript
  @ApiProperty({ required: false, description: 'Whether coop terms were accepted' })
  @IsOptional()
  @IsBoolean()
  coopTermsAccepted?: boolean;

  @ApiProperty({ description: 'Whether privacy policy was accepted' })
  @IsBoolean()
  privacyAccepted: boolean;
```

`IsBoolean` is already imported (line 10).

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/coops/dto/public-register.dto.ts
git commit -m "feat: add terms acceptance fields to public register DTO"
```

### Task 10: Add terms fields to registrations service `createBuy`

**Files:**
- Modify: `apps/api/src/modules/registrations/registrations.service.ts:165-242`

- [ ] **Step 1: Extend the `createBuy` data parameter**

Add to the data type (after `isGift?: boolean;` on line 173):

```typescript
    coopTermsAcceptedAt?: Date;
    coopTermsVersion?: string;
    privacyAcceptedAt?: Date;
    privacyVersion?: string;
```

- [ ] **Step 2: Include fields in the Prisma create call**

In the `tx.registration.create` data object (lines 223-238), add after `channelId`:

```typescript
          coopTermsAcceptedAt: data.coopTermsAcceptedAt || null,
          coopTermsVersion: data.coopTermsVersion || null,
          privacyAcceptedAt: data.privacyAcceptedAt || null,
          privacyVersion: data.privacyVersion || null,
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/registrations/registrations.service.ts
git commit -m "feat: pass terms acceptance fields through createBuy"
```

### Task 11: Validate and store terms in channels service

**Files:**
- Modify: `apps/api/src/modules/channels/channels.service.ts:372-468`

- [ ] **Step 1: Add validation after channel lookup**

After the channel is found and verified (around line 403), add validation:

```typescript
    // Validate terms acceptance
    if (channel.termsUrl && !dto.coopTermsAccepted) {
      throw new BadRequestException('You must accept the cooperative terms and conditions');
    }

    if (!dto.privacyAccepted) {
      throw new BadRequestException('You must accept the privacy policy');
    }
```

Add `BadRequestException` to imports if not already there.

- [ ] **Step 2: Pass terms data to createBuy**

In the `this.registrationsService.createBuy()` call (line 462-468), add the terms fields:

```typescript
    const now = new Date();
    const registration = await this.registrationsService.createBuy({
      coopId: coop.id,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
      channelId: channel.id,
      isGift: dto.isGift,
      ...(dto.coopTermsAccepted && channel.termsUrl && {
        coopTermsAcceptedAt: now,
        coopTermsVersion: channel.termsUrl,
      }),
      privacyAcceptedAt: now,
      privacyVersion: PRIVACY_VERSION,
    });
```

Add the import at the top:

```typescript
import { PRIVACY_VERSION } from '@opencoop/shared';
```

- [ ] **Step 3: Also update the legacy coops.service.ts `publicRegister` method**

File: `apps/api/src/modules/coops/coops.service.ts:631-682`

This is the old endpoint (`POST /coops/:slug/register`). Apply the same pattern — but since this endpoint doesn't have channel context, only validate `privacyAccepted`:

```typescript
    if (!dto.privacyAccepted) {
      throw new BadRequestException('You must accept the privacy policy');
    }
```

And pass through to `createBuy`:

```typescript
    const registration = await this.registrationsService.createBuy({
      coopId: coop.id,
      shareholderId,
      shareClassId: dto.shareClassId,
      quantity: dto.quantity,
      projectId: dto.projectId,
      privacyAcceptedAt: new Date(),
      privacyVersion: PRIVACY_VERSION,
    });
```

Import `PRIVACY_VERSION` from `@opencoop/shared`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/channels/channels.service.ts apps/api/src/modules/coops/coops.service.ts
git commit -m "feat: validate and store terms acceptance in registration endpoints"
```

### Task 12: Wire frontend registration form to send acceptance data

**Files:**
- Modify: `apps/web/src/components/coop-register-content.tsx`

- [ ] **Step 1: Add `acceptPrivacy` to the form schema**

In `registrationSchema` (line 108-129), add after `acceptTerms`:

```typescript
  acceptPrivacy: z.literal(true).optional(),
```

**Important:** Keep `acceptTerms` as `z.literal(true).optional()` (its current state). The coop terms checkbox is only required when the coop has `termsUrl`. The privacy checkbox is always required. This conditional validation is handled in `onSubmit` and the submit button disabled state, not in the Zod schema.

- [ ] **Step 2: Add privacy checkbox to the UI**

After the existing terms checkbox block (lines 1039-1066), add a privacy policy checkbox:

```tsx
        {/* Privacy Policy */}
        <div className="flex items-start space-x-2 mt-2">
          <Checkbox
            id="privacy"
            checked={form.watch('acceptPrivacy') || false}
            onCheckedChange={(checked) =>
              form.setValue('acceptPrivacy', checked === true ? true : undefined as never)
            }
          />
          <Label htmlFor="privacy" className="text-sm">
            {t('registration.acceptPrivacyPrefix')}{' '}
            <a
              href={`/${locale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline"
              style={{ color: coop.primaryColor }}
            >
              {t('registration.privacyPolicy')}
            </a>
          </Label>
        </div>
```

You'll need to get `locale` from the component's context. Check the existing component to see if it's already available (e.g., via `useLocale()` from `next-intl`), or add it.

- [ ] **Step 3: Update form validation trigger**

In `onSubmit` (line 419), add `acceptPrivacy` to the trigger. Keep `acceptTerms` in the list (it's optional in the schema so it won't fail validation when not provided):

```typescript
    const valid = await form.trigger(['shareClassId', 'quantity', 'acceptTerms', 'acceptPrivacy']);
```

Also add a manual check for privacy acceptance right after (since `acceptPrivacy` is `.optional()` in the schema for TypeScript compat but must be true):

```typescript
    if (!form.getValues('acceptPrivacy')) return;
```

- [ ] **Step 4: Update submit button disabled state**

On line 1076, add privacy check. Note: `acceptTerms` is only required when the coop has a `termsUrl`:

```typescript
disabled={
  (coop.termsUrl && !form.watch('acceptTerms')) ||
  !form.watch('acceptPrivacy') ||
  !watchShareClassId ||
  watchQuantity < 1 ||
  submitting
}
```

- [ ] **Step 5: Include acceptance in API payload**

In the `onSubmit` function, add to both payload branches (lines 436-442 and 450-471):

```typescript
          coopTermsAccepted: values.acceptTerms === true,
          privacyAccepted: values.acceptPrivacy === true,
```

- [ ] **Step 6: Add translation keys**

Add to all 4 locale files under `registration`:

```json
"acceptPrivacyPrefix": "I accept the",
"privacyPolicy": "Privacy Policy"
```

- [ ] **Step 7: Verify end-to-end**

1. Navigate to a coop's registration page (e.g., `http://localhost:3002/en/demo/default/register`)
2. Fill in shareholder details and share selection
3. Verify both checkboxes appear (coop terms only if coop has `termsUrl`)
4. Try to submit without checking → should be blocked
5. Check both → submit should work
6. Verify in database that Registration record has all 4 acceptance fields populated

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/coop-register-content.tsx apps/web/messages/
git commit -m "feat: wire terms and privacy acceptance to registration form"
```

---

## Chunk 5: Final Verification & Cleanup

### Task 13: Full build and type check

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: All packages build successfully with no type errors.

- [ ] **Step 2: Run existing tests**

Run: `cd apps/api && pnpm test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 3: Verify both flows end-to-end**

1. **Onboarding**: Create a new coop via `/onboarding?plan=free`. Verify terms checkbox is present, required, and acceptance is stored on the User record.
2. **Registration**: Register as a shareholder on the demo coop. Verify both checkboxes appear, are required, and acceptance is stored on the Registration record.

- [ ] **Step 4: Commit any fixes**

If any issues were found, fix and commit them individually.
