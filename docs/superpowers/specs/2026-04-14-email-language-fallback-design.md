# Email language fallback + locale capture on registration

**Date:** 2026-04-14
**Status:** Design
**Authors:** Wouter + Claude

## Problem

Bronsgroen shareholders browsing the site in `nl-BE` are receiving share-purchase emails in English. The reported complaint is "default NL if nothing is detected" — but the root cause is broader.

**Root cause (confirmed in code):**

1. `User.preferredLanguage` defaults to `"nl"` in the DB (`schema.prisma:252`), so the data layer is fine.
2. Several email templates in `apps/api/src/modules/email/email.processor.ts` are **hardcoded English** and ignore `preferredLanguage` entirely:
   - `share-purchase` (the main Bronsgroen complaint)
   - `welcome`, `dividend-statement`, `password-reset`, `magic-link`, `gift-certificate`
3. The corresponding service methods in `email.service.ts` don't forward a `language` field or localize the subject.
4. Two templates that *do* support multiple languages (`payment-confirmed`, `message-notification`) fall back to `t['en']` when the key is missing — should be `t['nl']` per product decision.
5. The shareholder registration page `(auth)/register/page.tsx` POSTs only `{email, password}` — it never forwards the user's current locale, so new users rely on the DB default.

The bug is system-wide, not Bronsgroen-specific. Bronsgroen surfaces it because their entire member base is Dutch-speaking.

## Goals

1. Every outgoing email respects `User.preferredLanguage` (nl / en / fr / de).
2. When no language can be determined, emails default to **NL**, not EN.
3. New users' `preferredLanguage` is set from the current `useLocale()` (next-intl) at registration time, so the signal from the URL/locale switcher is preserved.

## Non-goals

- Backfilling existing users' `preferredLanguage`.
- Per-coop default language field (`Coop.defaultLanguage`).
- Per-shareholder language field (`Shareholder.preferredLanguage`) for shareholders without user accounts.
- Changes to the settings-page language selector (already works).
- Translating internal admin-facing templates (admin digest, event notification, minor-upgrade series) — out of scope for this PR; those are either NL-only by design or admin-only.

## Architecture

Two parallel tracks, one PR:

### Track 1 — Backend: every template respects language, NL fallback

**New helper in `email.service.ts`:**

```ts
private async resolveRecipientLanguage(email: string): Promise<string> {
  const user = await this.prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { preferredLanguage: true },
  });
  return user?.preferredLanguage || 'nl';
}
```

Each `sendX` method in `email.service.ts`:

1. Calls `resolveRecipientLanguage(to)` at the top. If the caller already has the language (e.g., `sendPaymentConfirmation`, `sendMessageNotification`), accept an optional `language` param that skips the lookup.
2. Picks a localized subject from a per-method subject map `{ nl, en, fr, de }` keyed by language, with NL fallback.
3. Includes `language` in `templateData` so the renderer can pick the right body variant.

Call sites are unchanged for methods that don't already pass language — they get the lookup for free.

**Trade-off:** one extra DB query per email send. Negligible given emails are queued through Bull and rare.

**Templates to convert to `t[lang] || t['nl']` pattern** in `email.processor.ts`:

1. `welcome`
2. `share-purchase` — main Bronsgroen complaint
3. `dividend-statement`
4. `password-reset`
5. `magic-link`
6. `gift-certificate`

**Templates already correct but with wrong fallback key:** flip `|| t['en']` → `|| t['nl']` in `payment-confirmed:286` and `message-notification:443`.

**Templates left unchanged:** `minor-*` and `referral-success` (NL-hardcoded, Belgian minors flow); `admin-message-notification`, `admin-event-notification`, `admin-digest` (admin-facing, mixed EN/NL, out of scope).

Translations will be drafted using existing `apps/web/messages/{nl,en,fr,de}.json` as the reference for tone and terminology, so email copy is consistent with the in-app UI.

### Track 2 — Frontend: capture `useLocale()` on registration

Three pages add `preferredLanguage: useLocale()` to their registration POST body:

1. **`apps/web/src/app/[locale]/(auth)/register/page.tsx`** — currently sends `{email, password}` only (line 50–53). Add locale.
2. **`apps/web/src/components/coop-register-content.tsx`** — public coop register flow (the main Bronsgroen path). Already imports `useLocale` at line 142; add `preferredLanguage: locale` to the registration POST body.
3. **`apps/web/src/app/[locale]/onboarding/page.tsx`** — coop admin onboarding. Verify `preferredLanguage` is in the POST; add if missing.

**Backend DTOs** (`register.dto.ts`, `onboarding.dto.ts`) already accept an optional `preferredLanguage` field — no backend DTO changes needed.

## Data flow

```
Frontend page (useLocale())
    │  preferredLanguage in POST body
    ▼
Auth service creates User with preferredLanguage
    │
    ▼
Shareholder gets linked to User (orphan linking flow exists)
    │
    ▼
Later: email service needs to send to shareholder.email
    │  resolveRecipientLanguage(email) → User.preferredLanguage || 'nl'
    ▼
Subject + body rendered in that language
```

## Testing

**Automated (new):**
- Unit test for `EmailService.resolveRecipientLanguage`:
  - User exists with `preferredLanguage='fr'` → `'fr'`
  - User row missing → `'nl'`
  - User exists but `preferredLanguage` is `null` / empty → `'nl'`

**Manual (smoke on acc):**
- Register a new user at `/nl/register` → verify `user.preferredLanguage === 'nl'` in Prisma Studio.
- Repeat for `/en/...`, `/fr/...`, `/de/...`.
- Trigger a share-purchase flow as a NL shareholder on a test coop → confirm subject and body arrive in Dutch.

**Regression:**
- `pnpm test` in `apps/api` — make sure nothing that mocks `EmailService` breaks.

## Rollout

- Single PR to `main` → auto-deploys to `acc.opencoop.be`.
- Smoke-test on acc with a test coop mirroring Bronsgroen's setup.
- Tag a **patch** version (e.g., `v0.7.62`) for prod — this is a bug fix, not a feature.
- Update `CHANGELOG.md` in the same flow.
- Zero downtime, no migration.

## Risks

- **Translation quality:** draft translations may not match Bronsgroen's tone. Mitigation: reuse strings from existing i18n JSON where possible; flag to user if anything is uncertain.
- **Existing users with `preferredLanguage='en'`:** they continue to receive EN emails until they flip the setting manually. Accepted per product decision (A in clarifying Q4). If complaints arrive, a targeted SQL update for Bronsgroen users is a 5-line follow-up.
- **Fallback flip from `'en'` to `'nl'`:** a user in the `payment-confirmed` or `message-notification` flows with `preferredLanguage` set to some exotic value (e.g., `'es'`) will now see NL instead of EN. Acceptable — the DB default is `'nl'` and only nl/en/fr/de are valid values.
