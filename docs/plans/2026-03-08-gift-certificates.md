# Gift Certificate Feature — Design

**Date:** 2026-03-08
**Status:** Approved
**Scope:** End-to-end gift share purchases: buyer registration, gift code generation, PDF certificate, email delivery, recipient claim, share transfer

---

## Problem

The registration flow supports a "gift" beneficiary type in the frontend, but the backend is completely stubbed. No gift codes are generated, no claim endpoint exists, and the claim page has no API to call. The feature needs full implementation from database to UI.

## Design

### Ownership Model

Shares belong to the buyer from payment confirmation until the gift is claimed. On claim, a TRANSFER registration moves shares from buyer to recipient. Both shareholder records persist (cooperatives must retain records for 7+ years).

### Gift Code Format

`XXXX-XXXX` — 8 alphanumeric characters from a 32-char alphabet (A-Z, 2-9, excluding ambiguous 0/O/I/1/L). ~1.1 trillion combinations. Stored plain text in the database (single-use, not security-critical like passwords). Generated server-side when registration reaches COMPLETED status.

### Data Model Changes

Add to the `Registration` model in `packages/database/prisma/schema.prisma`:

```prisma
model Registration {
  // ... existing fields ...
  isGift                    Boolean    @default(false)
  giftCode                  String?    @unique
  giftClaimedAt             DateTime?
  giftClaimedByShareholderId String?
  giftClaimedByShareholder  Shareholder? @relation("GiftClaimedBy", fields: [giftClaimedByShareholderId], references: [id])
}
```

Add reverse relation on `Shareholder`:

```prisma
model Shareholder {
  // ... existing fields ...
  claimedGifts  Registration[] @relation("GiftClaimedBy")
}
```

### Flow

```
1. Buyer selects "gift" beneficiary type in registration form
   → enters own email, selects share class + quantity
   → Step 4 shows bank details + message:
     "You'll receive the gift certificate by email once payment clears"

2. Buyer pays via bank transfer

3. Payment matched (any path: admin manual, CSV import, future bank sync)
   → Registration transitions to COMPLETED
   → If isGift: generate gift code, create PDF, email to buyer

4. Buyer receives email with:
   → Gift certificate PDF attached
   → Inline: gift code, claim link, instructions

5. Buyer shares certificate with recipient

6. Recipient visits /{coopSlug}/{channelSlug}/claim?code=XXXX-XXXX
   → Code auto-filled from URL, or typed manually
   → Validates code → shows gift details (coop, shares, quantity, value)
   → Fills full shareholder form (name, DOB, email, address, national ID)
   → Submits claim

7. Backend on claim:
   → Creates new Shareholder for recipient
   → Creates TRANSFER registration (SELL from buyer, BUY to recipient)
   → Sets giftClaimedAt + giftClaimedByShareholderId on original registration
   → Sends welcome email to recipient (optional, if coop has email enabled)
```

### API Endpoints

#### New

**`GET /coops/:slug/channels/:channelSlug/gift/:code/validate`**
- Public, rate limited (5 requests / IP / 15 min)
- Returns: `{ valid: true, coopName, shareClassName, quantity, totalValue }` or `{ valid: false }`
- Does NOT reveal buyer identity

**`POST /coops/:slug/channels/:channelSlug/claim`**
- Public, rate limited (5 requests / IP / 15 min)
- Body: `{ giftCode, firstName, lastName, dateOfBirth, email, street, number, postalCode, city, nationalId? }`
- Creates recipient shareholder + TRANSFER registrations
- Returns: `{ success: true, shareholderId }`

#### Modified

**`POST /coops/:slug/channels/:channelSlug/register`**
- Accept `isGift: boolean` in request body
- When `isGift: true`, create Registration with `isGift: true`
- No gift code generated at this point

**Payment matching (all paths)**
- `PaymentsService.addPayment()` — when transitioning to COMPLETED, check `isGift`
- `RegistrationsService.complete()` — same check
- If `isGift && !giftCode`: generate code, create PDF, queue email to buyer

### Gift Code Generation Hook

The gift code generation triggers on the status transition to COMPLETED, not on a specific payment path. This covers:

1. `PaymentsService.addPayment()` — payment fully covers amount → COMPLETED
2. `BankImportService.importBelfiusCsv()` — bank import auto-match → COMPLETED
3. `BankImportService.manualMatch()` — manual bank transaction match → COMPLETED
4. `RegistrationsService.complete()` — admin manual completion

The cleanest approach: extract a `onRegistrationCompleted(registrationId)` hook that all 4 paths call after setting status to COMPLETED. This hook checks `isGift` and triggers code generation + email.

### Gift Certificate PDF

New template in `packages/pdf-templates/src/templates/gift-certificate.ts`:
- A4 portrait
- Coop logo + brand color header
- "Cadeaubon" / "Gift Certificate" (localized)
- Share class name + quantity + total value (e.g., "5 aandelen A — € 250,00")
- Gift code in large monospace text
- QR code pointing to `https://{domain}/{coopSlug}/{channelSlug}/claim?code=XXXX-XXXX`
- Claim instructions in small text

### Claim Page Updates

Wire up existing stub at `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx`:

**Step 1: Enter code**
- Input field, auto-filled from `?code=` URL param
- "Validate" button → calls validate endpoint
- On success: shows gift details (coop, share class, quantity, value)
- On failure: generic error, rate limit message after 5 attempts

**Step 2: Your details**
- Full shareholder form: first name, last name, DOB, email, street, number, postal code, city, national ID (optional)
- Submit → calls claim endpoint
- On success: confirmation screen ("Welcome! Your shares have been registered.")

### Registration Form (Step 4 — Payment)

When `beneficiaryType === 'gift'`:
- Show same payment details (QR, IBAN, OGM)
- Replace confirmation text with: "You'll receive the gift certificate by email once payment clears"
- Do NOT show gift code (doesn't exist yet)

### Buyer Dashboard

In the buyer's registrations/transactions view:
- Gift registrations show a badge: "Gift" with status:
  - "Awaiting payment" (PENDING_PAYMENT)
  - "Awaiting claim" (COMPLETED, not claimed)
  - "Claimed by [recipient name]" (claimed)
- "Download gift certificate" link when gift code exists (COMPLETED + not yet claimed)

### Rate Limiting

Both gift endpoints rate limited at 5 requests per IP per 15 minutes. Use NestJS `@Throttle()` decorator with a dedicated throttle group for gift endpoints.

### i18n Keys Needed

New keys for all 4 locales (en, nl, fr, de):
- `registration.gift.emailAfterPayment` — "You'll receive the gift certificate by email once payment clears"
- `gift.certificate.title` — "Gift Certificate" / "Cadeaubon" / "Chèque-cadeau" / "Geschenkgutschein"
- `gift.certificate.shares` — "{count} shares {className}"
- `gift.certificate.instructions` — "Scan the QR code or visit the link below to claim your shares"
- `gift.claim.title` — "Claim Gift Certificate"
- `gift.claim.enterCode` — "Enter your gift code"
- `gift.claim.validate` — "Validate"
- `gift.claim.invalidCode` — "Invalid or already claimed gift code"
- `gift.claim.rateLimited` — "Too many attempts. Please try again later."
- `gift.claim.details` — "Gift details"
- `gift.claim.yourDetails` — "Your details"
- `gift.claim.success` — "Welcome! Your shares have been registered."
- `gift.badge.awaitingClaim` — "Gift — awaiting claim"
- `gift.badge.claimed` — "Gift — claimed by {name}"
- `gift.email.subject` — "Your gift certificate for {coopName}"
- `gift.email.body` — "Your payment has been received. Attached is the gift certificate..."

### Files to Modify

| File | Change |
|------|--------|
| `packages/database/prisma/schema.prisma` | Add gift fields to Registration, relation on Shareholder |
| `apps/api/src/modules/coops/dto/public-register.dto.ts` | Add `isGift` field |
| `apps/api/src/modules/channels/channels.service.ts` | Pass `isGift` to registration creation |
| `apps/api/src/modules/registrations/registrations.service.ts` | Gift code generation, `onRegistrationCompleted` hook |
| `apps/api/src/modules/payments/payments.service.ts` | Call `onRegistrationCompleted` after COMPLETED transition |
| `apps/api/src/modules/bank-import/bank-import.service.ts` | Call `onRegistrationCompleted` after COMPLETED transition |
| `packages/pdf-templates/src/templates/gift-certificate.ts` | New: gift certificate PDF template |
| `packages/pdf-templates/src/index.ts` | Export new template |
| `apps/api/src/modules/email/email.service.ts` | Gift certificate email method |
| `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx` | Wire up to real API |
| `apps/web/src/components/coop-register-content.tsx` | Update Step 4 copy for gifts |
| `apps/web/messages/{en,nl,fr,de}.json` | Add gift i18n keys |

### What Stays The Same

- Registration form steps 1-3 (already handle gift beneficiary type)
- EPC QR code generation for payment
- OGM code generation
- All existing share class / project selection logic

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/channels/dto/claim-gift.dto.ts` | Claim request validation |
| `apps/api/src/modules/channels/dto/validate-gift.dto.ts` | Validate response shape |
| `packages/pdf-templates/src/templates/gift-certificate.ts` | PDF template |
