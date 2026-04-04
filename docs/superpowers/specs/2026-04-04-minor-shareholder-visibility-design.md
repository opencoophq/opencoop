# Minor Shareholder Visibility & Management

**Date:** 2026-04-04
**Status:** Approved
**Context:** Parents who register minor (child) shareholders cannot see or manage their children's shares. Minors have no user account and cannot log in. The parent's dashboard only shows their own shares.

## Problem

When a parent like Maarten Kalders has children (Marie, Lowie) registered as MINOR shareholders via `registeredByUserId`, these children's shares are invisible in the shareholder dashboard. The parent can only see their own shares. Children's shares are only visible in the admin panel.

Additionally, `birthDate` is not enforced for MINOR shareholders, which breaks the existing `birthday-scheduler.service.ts` that handles the minor-to-adult upgrade flow (it queries by `birthDate` to find minors turning 18).

## Solution

Show children's shares as separate sections below the parent's own shares on the dashboard. Allow the parent to buy/sell shares and edit profiles on behalf of their children through the same self-service endpoints.

## Design

### 1. Backend — Auth Service (`getProfile`)

**File:** `apps/api/src/modules/auth/auth.service.ts` (~line 422)

Add `registeredShareholders` to the Prisma include in `getProfile()`:

```typescript
registeredShareholders: {
  where: { type: 'MINOR' },
  include: {
    coop: { select: { id, name, slug, bankIban, bankBic, minimumHoldingPeriod, channels: ... } },
    registrations: {
      include: { shareClass: true, project: true, payments: { orderBy: { bankDate: 'asc' } }, giftClaimedByShareholder: ... }
    },
    dividendPayouts: { include: { dividendPeriod: { include: { coop: ... } } } },
    documents: { orderBy: { generatedAt: 'desc' } },
  },
}
```

Apply the same `computeVestedShares` logic to minor shareholders' registrations (lines 509-526).

Return as `minorShareholders` array on the response, sorted by `firstName`.

### 2. Backend — Shareholder Actions Guard

**File:** `apps/api/src/modules/shareholders/shareholder-actions.controller.ts` (line 142-157)

Extend `verifyShareholder()` to also allow access when the shareholder is a MINOR registered by the current user:

```typescript
private async verifyShareholder(shareholderId: string, userId: string) {
  const shareholder = await this.prisma.shareholder.findUnique({
    where: { id: shareholderId },
    include: { coop: { select: { id: true, minimumHoldingPeriod: true } } },
  });

  if (!shareholder) {
    throw new NotFoundException('Shareholder not found');
  }

  const isOwner = shareholder.userId === userId;
  const isParentOfMinor = shareholder.type === 'MINOR' && shareholder.registeredByUserId === userId;

  if (!isOwner && !isParentOfMinor) {
    throw new ForbiddenException('You can only manage your own shareholder records');
  }

  return shareholder;
}
```

This enables buy, sell, profile edit, certificate generation, and bank details update for children — all through existing endpoints with no new routes.

### 3. Backend — birthDate Enforcement

Make `birthDate` required when `type === MINOR`:

**`apps/api/src/modules/shareholders/shareholders.service.ts`** — in `create()` and `update()`:
- Throw `BadRequestException('birthDate is required for MINOR shareholders')` if type is MINOR and birthDate is missing/null.

**`apps/api/src/modules/shareholders/dto/create-shareholder.dto.ts`** — no DTO-level change needed since the conditional validation is cleaner in the service layer (DTO doesn't know the type context at validation time for updates).

**Import service** — already validates this (`shareholder-import.service.ts` line 202).

### 4. Frontend — Shares Page

**File:** `apps/web/src/app/[locale]/dashboard/shares/page.tsx`

After the parent's "Mijn aandelen" card, render one card per minor shareholder:

```
┌─────────────────────────────────────────────────────┐
│ Mijn aandelen                             [Kopen]   │
│ ─────────────────────────────────────────────────── │
│ Aandeel A (A)  │ 1 │ €125,00 │ 19/8/2014 │ ✅     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Aandelen van Marie Kalders              ✏️  [Kopen] │
│ ─────────────────────────────────────────────────── │
│ Aandeel A (A)  │ 1 │ €125,00 │ 3/11/2014 │ ✅     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Aandelen van Lowie Kalders              ✏️  [Kopen] │
│ ─────────────────────────────────────────────────── │
│ Aandeel A (A)  │ 1 │ €125,00 │ 2/8/2016  │ ✅     │
└─────────────────────────────────────────────────────┘
```

**Data loading (normal mode):** Fetch `minorShareholders` from the `/auth/me` response. For each minor, filter registrations the same way as the parent's (ACTIVE/PENDING_PAYMENT/COMPLETED).

**Data loading (admin preview mode):** When previewing a shareholder, also fetch their registered minors. Add a new admin endpoint `GET /admin/coops/:coopId/shareholders/:id/minors` that returns MINOR shareholders where `registeredByUserId` matches the previewed shareholder's `userId`. Returns an empty array if the shareholder has no `userId`. This keeps the existing `findById` endpoint unchanged.

**Buy/sell for children:** Each child section has its own "Kopen" button and sell actions. These call the same endpoints (`POST /shareholders/:shareholderId/buy`, `POST /shareholders/:shareholderId/sell-request`) using the child's `shareholderId`. The buy dialog loads share classes via `GET /shareholders/:childShareholderId/share-classes`.

**Profile edit for children:** A pencil icon (✏️) in the child section header opens a dialog with: firstName, lastName, birthDate (required), phone, address fields. Submits via `PUT /shareholders/:childShareholderId/profile`.

### 5. Frontend — Dashboard Overview

**File:** `apps/web/src/app/[locale]/dashboard/page.tsx`

Update the stats calculation (lines 58-77) to also iterate over `minorShareholders` and sum their completed registrations into `totalShares` and `totalValue`. This gives the parent a complete family overview in the stat cards.

### 6. Frontend — Admin Shareholder Detail

**File:** `apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx`

When viewing a shareholder detail in admin mode, if the shareholder has registered minors, show a small section listing them with links. This already exists implicitly through the shareholders list (admin can search for minors), but having a direct link from parent → children improves admin UX.

### 7. i18n

New translation keys in `apps/web/messages/{en,nl,fr,de}.json`:

| Key | NL | EN |
|-----|----|----|
| `shares.childShares` | Aandelen van {name} | Shares of {name} |
| `shares.editChildProfile` | Profiel bewerken | Edit profile |
| `shares.childProfileTitle` | Profiel van {name} | Profile of {name} |
| `shareholders.birthDateRequired` | Geboortedatum is verplicht voor minderjarige aandeelhouders | Date of birth is required for minor shareholders |
| `shares.birthDate` | Geboortedatum | Date of birth |

## Out of Scope

- Minor-to-adult upgrade flow (already implemented in `birthday-scheduler.service.ts`)
- Email notifications to parents about children's shares
- Adding new minor shareholders from the parent dashboard (admin-only)
- Dividend payout display for minors (can be added later as a follow-up)
