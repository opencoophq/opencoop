# Charge Cards (Laadpassen) — Design Document

**Date:** 2026-10-05
**Status:** Draft

## Overview

Coops can issue EV charging cards to their shareholders. A shareholder requests a card in the dashboard and pays a one-time fee by bank transfer with an OGM. A coop admin issues the physical card and records its number. OpenCoop is the source of truth for which cards are valid. A future charging platform reads that list and reports card usage back.

First user: Bronsgroen. `bronsgroen.be/[locale]/laadpas` is a marketing page that links into the OpenCoop dashboard.

## Versions

- **v1 (this plan): no provider integration.** Nobody has access to the provider portal yet. OpenCoop handles requests, payment and issuing, and tells admins what to change in the provider portal by hand.
- **v2: provider integration.** Sync card status and usage with the provider, once we know what its portal and API support. This includes the automatic inactivity rule.

## Key Decisions

- **Inside OpenCoop, not a separate app.** Login, shareholder status, the four locales, the admin panel and OGM bank matching already live here.
- **Feature-gated per coop.** `Coop.chargeCardsEnabled`, following the Ecopower pattern.
- **Several cards per shareholder.** Each card costs the fee and carries a label ("Car Anna", "Van 2"). Companies need fleets; the schema costs the same either way. No cap in v1; admins see every request.
- **One-time fees, set incl. VAT.** Source: Bronsgroen "Pasjesbeleid laadpaal De Schom" (Oct 2026), rounded by Bronsgroen to whole euros. `Coop.chargeCardFee` (€6.00 incl. VAT, first card; €4.96 excl.) and `Coop.chargeCardReplacementFee` (€12.00 incl. VAT, €9.92 excl., replacement after loss or theft; still to be confirmed by Bronsgroen). `Coop.chargeCardVatRate` (21) derives the excl.-VAT amount for invoicing: `round(incl / 1.21, 2)`, VAT = incl − excl. A card requested as a replacement for a `LOST` card carries `isReplacement = true` and the replacement fee. The fee is stored on the card (`feeInclVat`) at request time, so a later price change does not alter open requests.
- **VAT invoices come later, probably from Odoo** (odoo.bronsgroen.be). v1 creates no invoices. A later version pushes paid cards to Odoo.
- **Non-roaming cards only.** Roaming (€18/year) is on hold.
- **Processing within 5 working days.** The admin list shows how long each card has waited and highlights cards older than 5 working days in `REQUESTED` or `PAID`.
- **Two automatic block rules**, each with its own reason so unblocking is unambiguous:
  - `NO_SHARES`: the shareholder's status leaves ACTIVE. The card unblocks automatically when the shareholder is ACTIVE again.
  - `INACTIVITY`: no use for `Coop.chargeCardInactivityMonths` (6 for Bronsgroen). The shareholder re-enables it in the dashboard, free and instant.
- **The inactivity rule is the cost control.** The provider bills €1.25 per active card per month. A card that is never used costs at most 6 × €1.25 = €7.50 before it is blocked. Each use moves the expiry forward.
- **Card status must stay in sync with the provider.** A block in OpenCoop only saves money if the provider deactivates the card too, and a re-enable must reactivate it there. Usage data also lives at the provider. Until the provider integration exists, `chargeCardInactivityMonths` stays `null` (rule off), because without usage data every card looks unused.
- **Payments become generic.** A `Payment` belongs to either a `Registration` or a `ChargeCard`. No parallel payment table.

## Card Lifecycle

```
REQUESTED ──fee matched──▶ PAID ──admin enters card number──▶ ACTIVE
    │                                                      │   ▲
    └──shareholder/admin cancels──▶ CANCELLED              ▼   │ unblock
                                                         BLOCKED
                                       (NO_SHARES | INACTIVITY | LOST | ADMIN)
```

- `LOST` and `ADMIN` blocks are final for the shareholder. Only an admin can lift an `ADMIN` block. `LOST` never unblocks.
- A request can only be made while the shareholder is ACTIVE.

## Database Schema Changes

### New model: ChargeCard

```prisma
model ChargeCard {
  id            String            @id @default(cuid())
  coopId        String
  shareholderId String
  label         String?
  status        ChargeCardStatus  @default(REQUESTED)
  blockReason   ChargeCardBlockReason?
  ogmCode       String            @unique
  cardNumber    String?           // printed number or RFID UID, set on issue
  requestedAt   DateTime          @default(now())
  issuedAt      DateTime?
  blockedAt     DateTime?
  activatedAt   DateTime?         // set on issue, re-enable and every unblock
  lastUsedAt    DateTime?         // reported by the charging platform only

  coop        Coop        @relation(fields: [coopId], references: [id], onDelete: Cascade)
  shareholder Shareholder @relation(fields: [shareholderId], references: [id], onDelete: Cascade)
  payments    Payment[]

  @@unique([coopId, cardNumber])
  @@index([shareholderId])
  @@index([coopId, status])
  @@map("charge_cards")
}

enum ChargeCardStatus { REQUESTED PAID ACTIVE BLOCKED CANCELLED }
enum ChargeCardBlockReason { NO_SHARES INACTIVITY LOST ADMIN }
```

### Coop

```prisma
chargeCardsEnabled         Boolean  @default(false)
chargeCardFee              Decimal  @default(5.00) @db.Decimal(12, 2)
chargeCardInactivityMonths Int?     // null = inactivity rule off
```

### Payment

- `registrationId` becomes nullable.
- Add `chargeCardId String?` with its relation.
- Add a DB check constraint in the migration: exactly one of `registrationId` and `chargeCardId` is set.
- Every reader of `payment.registration` must handle a null registration. Known readers: `admin-notifications.service.ts:185` (one card payment would crash the whole digest), `system/system.controller.ts:110`, `bank-import.service.ts:33`, `payments.service.ts:17-22`.

### OGM codes

Today `registrations.service.ts:365` builds the OGM from `registration.count + 1`. A second table under the same prefix would produce the same codes. Replace it with one per-coop atomic counter, `Coop.ogmSequence` (`UPDATE ... RETURNING`), used by registrations and cards. This also removes the count+1 race. Initialise it from the current highest sequence per coop.

### One OGM resolver

Matching is hard-wired to `Registration` in four places: `bank-import.service.ts:105-145`, `ponto.service.ts:336-353`, `payments.service.ts:49-64` (`addPayment`) and `manualMatch` (`bank-import.service.ts:375`). Add one `resolveOgmTarget(coopId, ogm)` that normalises the OGM and returns a registration or a charge card. All four call it. `manualMatch` accepts either target. A card accepts payment only in `REQUESTED`; a payment for a `CANCELLED` card stays unmatched.

## v1 Manual Provider Sync

OpenCoop cannot reach the provider in v1, so every change the provider must know about becomes an admin task:

- `ChargeCard.providerSyncNeeded Boolean @default(false)` is set when OpenCoop blocks or unblocks a card. The admin list shows these cards in a "To do in provider portal" filter. The admin makes the change in the portal and clicks "Done".
- Inactivity is not detected in v1. The provider's 6-month expiry happens outside OpenCoop. A shareholder whose card stopped working clicks "Re-enable my card" in the dashboard. OpenCoop sets `providerSyncNeeded` and emails the coop. The admin re-enables the card in the portal.
- `chargeCardInactivityMonths` and the `INACTIVITY` daily-job logic wait for v2.
- Payment-arrears blocks (below) wait for v2.

## v2 Additions from the Bronsgroen policy

- **Arrears block.** A card is blocked when its holder is more than 30 days behind on payment, and it unblocks automatically once paid. The board can suspend a card permanently after repeated arrears. Needs a new block reason `UNPAID` and arrears data from Zeno (the card provider).
- **Yearly cleanup** of the card list, aligned with the half-yearly school reporting. Scope to be defined with Bronsgroen.
- QR-code access for non-cooperants runs through Zeno's own payment page. OpenCoop is not involved.

## Flows

1. **Request.** Dashboard → Laadpassen → "Request a card" (optional label). OpenCoop creates the card in `REQUESTED`, shows the IBAN, amount and OGM, and emails the coop (Bronsgroen: info@bronsgroen.be).
2. **Payment.** CSV import or Ponto matches the OGM to the card. A matched payment of at least the fee moves the card to `PAID`. Unmatched or short payments use the existing unmatched-transaction flow.
3. **Issue.** Admin → Laadpassen lists cards by status. The admin enters the card number on a `PAID` card; it becomes `ACTIVE` and the shareholder gets an email.
4. **Shares sold.** A daily card job compares state, not events: it blocks `ACTIVE` cards whose shareholder is not ACTIVE (`NO_SHARES`) and unblocks `NO_SHARES` cards whose shareholder is ACTIVE again. Open `REQUESTED` cards of non-active shareholders are cancelled. State-based is required: the nightly `reconcileAll()` (`shareholder-status.service.ts:65-86`) is raw SQL, and admin edits (`shareholder-actions.controller.ts:232,280`) write status directly, so a hook in `recompute()` alone misses changes. Call the same logic from `recompute()` too, for immediacy.
5. **Inactivity (v2).** The same daily job blocks `ACTIVE` cards whose `max(lastUsedAt, activatedAt)` is older than the limit. The shareholder gets an email with a link to the dashboard.
6. **Re-enable (v2; v1 uses the manual flow above).** The dashboard shows an "Enable again" button on `INACTIVITY` cards. It sets the card to `ACTIVE` and `activatedAt = now`. Every unblock sets `activatedAt`, so a card unblocked after months is not re-blocked the next day. The shareholder must be ACTIVE.
7. **Lost.** The shareholder or an admin marks a card lost. Final.

## External API (charging platform) — v2

Under the existing per-coop API key guard in `modules/external-api`:

- `GET /external/charge-cards?status=ACTIVE` — valid card numbers, for the platform's allow list.
- `POST /external/charge-cards/usage` — batch of `{ cardNumber, usedAt }`; updates `lastUsedAt` when newer.

When the platform is chosen, check whether it speaks OCPI. If so, map this to the OCPI Tokens module instead of a custom shape.

## UI

- Shareholder dashboard: `apps/web/src/app/[locale]/dashboard/charge-cards/` — list, request, payment details, re-enable, report lost. Hidden unless `chargeCardsEnabled`.
- Admin: `dashboard/admin/charge-cards/` — filterable list, issue, block/unblock, cancel. Settings toggle and fee/inactivity fields in `admin/settings`.
- All strings in `apps/web/messages/{en,nl,fr,de}.json`. Emails in all four locales.

## bronsgroen.be (separate repo)

- `/[locale]/laadpas` landing page in nl/fr/en/de: what the card is, €5 one-time, shareholders only.
- Button → white-label redirect, like `/nl/login`, to the OpenCoop charge-cards page. Not logged in → OpenCoop login. Not a shareholder → "become a shareholder" link.
- The page also serves as the address in the inactivity email for re-enabling.

## Out of Scope (v1)

- Physical card stock, printing and postage.
- Charging sessions, kWh prices and billing for charging.
- A cap on cards per shareholder.
- Roaming cards (use on other networks). Bronsgroen offers non-roaming cards only. Adding a card type later is a small migration.

## Open Questions

- Card supplier and number format (printed number, RFID UID, or both).
- Which charging platform, and whether it supports OCPI.
