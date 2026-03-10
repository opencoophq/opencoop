# Ecopower Integration Design

## Problem

Coops using OpenCoop may have shareholders who are Ecopower energy clients. Ecopower requires its clients to maintain a minimum shareholding in an energy cooperative (e.g. €250). The coop needs to:

1. Track which shareholders are Ecopower clients (with optional Ecopower ID)
2. Prevent Ecopower clients from selling shares below the minimum threshold
3. Expose an API for external scripts to query share ownership and set Ecopower client status in batch

## Database Schema

### Coop model — new fields

```prisma
// Ecopower integration
ecoPowerEnabled          Boolean  @default(false)
ecoPowerMinThresholdType String?  // "EURO" | "SHARES"
ecoPowerMinThreshold     Decimal? @db.Decimal(10, 2)
apiKey                   String?  @unique
```

### Shareholder model — new fields

```prisma
// Ecopower client tracking
isEcoPowerClient Boolean @default(false)
ecoPowerId       String?
```

## API Endpoints

### External API (API key auth via `Authorization: Bearer <apiKey>`)

**`POST /api/external/shareholders/query`** — Batch query shareholders

- Body: `{ shareholders: [{ email?: string, nationalId?: string }] }`
- At least one identifier required per entry
- Returns: `{ results: [{ email, nationalId, firstName, lastName, totalShareValue, totalShares, isEcoPowerClient, ecoPowerId }] }`

**`PATCH /api/external/shareholders/ecopower`** — Batch update Ecopower status

- Body: `{ updates: [{ email?: string, nationalId?: string, isEcoPowerClient: boolean, ecoPowerId?: string }] }`
- Returns: `{ results: [{ email, nationalId, success: boolean, error?: string }] }`

### Admin API (existing JWT auth)

**`PATCH /admin/coops/:coopId/settings`** — extend to accept `ecoPowerEnabled`, `ecoPowerMinThresholdType`, `ecoPowerMinThreshold`

**`PATCH /admin/coops/:coopId/shareholders/:id`** — extend to accept `isEcoPowerClient`, `ecoPowerId`

**`POST /admin/coops/:coopId/api-key/regenerate`** — Generate/regenerate API key for the coop

## Exit Guard

In `createSell` and `createTransfer` (registrations.service.ts):

1. Check if shareholder `isEcoPowerClient` and coop has `ecoPowerEnabled`
2. Calculate remaining total after sale (across all share classes)
3. Compare against `ecoPowerMinThreshold` (euro amount or share count depending on `ecoPowerMinThresholdType`)
4. If below threshold → throw `BadRequestException` with descriptive message

Admin can remove `isEcoPowerClient` flag first if shareholder has canceled their Ecopower contract.

## Frontend

### Coop Settings page

- "Ecopower Integration" section (toggle, threshold type, threshold value, API key with regenerate)

### Shareholder detail page (when `ecoPowerEnabled`)

- Checkbox: "Ecopower client"
- Text field: "Ecopower ID" (optional)

### Shareholder list (when `ecoPowerEnabled`)

- Ecopower client filter/column

### Translations

- All new keys in en, nl, fr, de
