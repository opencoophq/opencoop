# Terms & Conditions and Privacy Policy

**Date**: 2026-03-10
**Status**: Approved

## Overview

OpenCoop currently has no platform-level terms and conditions for cooperatives signing up, and the existing shareholder registration T&C checkbox is front-end only with no audit trail. This design adds legally trackable T&C acceptance at both levels.

## Scope

### In Scope

- **Platform T&C** (OpenCoop <-> coop): acceptance during onboarding, stored on `User`
- **Shareholder T&C** (coop <-> shareholder): wire existing checkbox to API, stored on `Registration`
- **Privacy Policy** (OpenCoop <-> all users): acceptance during shareholder registration, stored on `Registration`
- Static pages for terms and privacy policy, fully translated in all 4 languages
- Versioned acceptance tracking (version string + timestamp)

### Out of Scope (Future Work)

- **Re-acceptance flow**: prompting existing coop admins to accept updated terms
- **Cookie consent banner**: GDPR-compliant cookie consent UI
- **DPA (Data Processing Agreement)**: formal data processing agreement between OpenCoop and cooperatives

## Database Changes

### `User` model

New nullable fields:

- `termsAcceptedAt DateTime?` — when the coop admin accepted platform T&C
- `termsVersion String?` — version string (e.g. `"2026-03-10"`)

### `Registration` model

New nullable fields:

- `coopTermsAcceptedAt DateTime?` — when the shareholder accepted the coop's terms
- `coopTermsVersion String?` — the `termsUrl` value at time of acceptance (serves as version identifier)
- `privacyAcceptedAt DateTime?` — when the shareholder accepted OpenCoop's privacy policy
- `privacyVersion String?` — version string (e.g. `"2026-03-10"`)

All fields are nullable so existing records are unaffected by the migration.

## Static Pages

Two new Next.js routes:

- `/[locale]/terms` — Platform Terms & Conditions
- `/[locale]/privacy` — Privacy Policy

Place at `apps/web/src/app/[locale]/terms/page.tsx` and `apps/web/src/app/[locale]/privacy/page.tsx` — outside any route group, so no auth middleware applies. These are public pages accessible without login.

Both are server-rendered pages using `next-intl` for the full legal content. The complete legal text is translated in all 4 languages (`en.json`, `nl.json`, `fr.json`, `de.json`).

A shared constants file exports `TERMS_VERSION` and `PRIVACY_VERSION` strings used when storing acceptance records.

## Onboarding Flow (Platform T&C)

### Frontend (`/onboarding`, Step 0 — Account fields)

- Add checkbox: "I accept the [Terms & Conditions](/terms)" (link opens in new tab)
- Submit button disabled until checkbox is checked
- The checkbox is rendered on Step 0 (account fields), but `termsAccepted` is included in the Step 1 API payload, which is when `POST /auth/onboarding` is called. The value must be carried across steps via form state.

### Backend (`POST /auth/onboarding`)

- Add to `OnboardingDto`: `termsAccepted: boolean` (required, must be `true`)
- Validate `termsAccepted === true`, reject with 400 if not
- The backend sets `termsVersion` from the shared `TERMS_VERSION` constant server-side (not from the client payload). This ensures the version is always correct and cannot be spoofed.
- Store `termsAcceptedAt: new Date()` and `termsVersion` on the created `User` record

## Shareholder Registration Flow (Coop T&C + Privacy Policy)

### Frontend (`coop-register-content.tsx`)

- Wire existing coop terms checkbox to send acceptance data to the API
- Add second checkbox: "I accept the [Privacy Policy](/privacy)" (always shown, required)
- Both relevant checkboxes must be checked before submit enables

### Backend (`POST /coops/:coopSlug/channels/:channelSlug/register`)

- Add to registration DTO:
  - `coopTermsAccepted: boolean?` — optional in the DTO
  - `privacyAccepted: boolean` — required, must be `true`
- Conditional validation is enforced in the **service**, not the DTO. The service fetches the channel, checks whether it has a `termsUrl`, and rejects the registration with 400 if `coopTermsAccepted` is not `true`.
- The backend sets version fields server-side:
  - `coopTermsVersion` = the channel's `termsUrl` at time of acceptance (fetched from the Channel model, not from the client)
  - `privacyVersion` = the shared `PRIVACY_VERSION` constant
- Store all four fields on the `Registration` record

## Translations

### New translation keys needed

- Full legal text for terms page (all 4 languages)
- Full legal text for privacy policy page (all 4 languages)
- Checkbox labels: "I accept the Terms & Conditions", "I accept the Privacy Policy"
- Page chrome: headings, "Last updated" labels

### Existing keys (already present)

- `registration.acceptTerms`, `registration.acceptTermsPrefix`
- `admin.settings.termsUrl`, `admin.settings.termsUrlDescription`

## Constants

Shared file (e.g. `packages/shared/src/legal.ts`):

```typescript
export const TERMS_VERSION = '2026-03-10';
export const PRIVACY_VERSION = '2026-03-10';
```

Updated whenever the legal text changes. The version string is set **server-side** — the backend imports the constant and stores it alongside the acceptance timestamp. This prevents stale or spoofed version strings from clients.

## Design Decisions

1. **Fields on existing models vs. junction table**: Fields on `User` and `Registration` are simpler and sufficient since there's no re-acceptance flow. A separate `TermsAcceptance` table would be needed if we add re-acceptance later.

2. **Coop terms version = `termsUrl`**: Each coop manages their own terms externally. We don't control their versioning, so the URL at time of acceptance is the best version identifier.

3. **Legal text in translation files**: Most coops are Belgian (NL/FR), so full i18n of legal text is necessary rather than English-only.

4. **No re-acceptance for existing coops**: Only new signups see the latest version. Existing coops aren't disrupted. This can be added as a future enhancement.

5. **Version strings set server-side**: The backend sets `termsVersion`, `privacyVersion`, and `coopTermsVersion` from trusted sources (shared constants or the channel's `termsUrl` field). The client only sends boolean acceptance flags, never version strings. This prevents spoofing and ensures the audit trail is legally defensible.

6. **`termsUrl` lives on Channel, not Coop**: The codebase stores `termsUrl` on the `Channel` model. The frontend gets it from the channel public-info API response. The `CoopPublicInfo` type in `packages/shared/src/types.ts` may need updating if `termsUrl` is not already included there.
