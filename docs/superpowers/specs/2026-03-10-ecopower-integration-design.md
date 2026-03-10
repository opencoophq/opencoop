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
ecoPowerEnabled          Boolean              @default(false)
ecoPowerMinThresholdType EcoPowerThresholdType?
ecoPowerMinThreshold     Decimal?             @db.Decimal(10, 2)
apiKeyHash               String?              @unique // bcrypt hash of the API key
apiKeyPrefix             String?              // first 8 chars for display (e.g. "abc1234...")
```

### New enum

```prisma
enum EcoPowerThresholdType {
  EURO
  SHARES
}
```

### Shareholder model — new fields

```prisma
// Ecopower client tracking
isEcoPowerClient Boolean @default(false)
ecoPowerId       String?
```

## API Key Security

- On generate/regenerate: create a random 32-byte key, return the plaintext once to the admin, store only the bcrypt hash + first 8 chars as prefix
- On external API request: hash the provided key and compare against stored `apiKeyHash`
- The plaintext key is never stored and cannot be retrieved after generation

## API Endpoints

### External API (API key auth via `Authorization: Bearer <apiKey>`)

The API key identifies the coop — the auth guard resolves the coop from the key hash. All downstream queries are scoped to that coop's ID.

**`POST /api/external/shareholders/query`** — Batch query shareholders

- Body: `{ shareholders: [{ email: string }] }` (max 500 per batch)
- Lookup by email only (nationalId is encrypted at rest and cannot be queried)
- Returns: `{ results: [{ email, firstName, lastName, totalShareValue, totalShares, isEcoPowerClient, ecoPowerId, found: boolean }] }`
- Shareholders not found return `{ email, found: false }`

**`PATCH /api/external/shareholders/ecopower`** — Batch update Ecopower status

- Body: `{ updates: [{ email: string, isEcoPowerClient: boolean, ecoPowerId?: string }] }` (max 500 per batch)
- Each update is independent (not transactional) — partial success is possible
- Returns: `{ results: [{ email, success: boolean, error?: string }] }`
- Unmatched emails return `{ email, success: false, error: "not found" }`

Rate limiting: 60 requests per minute per API key.

### Admin API (existing JWT auth)

**`PATCH /admin/coops/:coopId/settings`** — extend to accept `ecoPowerEnabled`, `ecoPowerMinThresholdType`, `ecoPowerMinThreshold`

**`PATCH /admin/coops/:coopId/shareholders/:id`** — extend to accept `isEcoPowerClient`, `ecoPowerId`. Returns 400 if coop has `ecoPowerEnabled = false`.

**`POST /admin/coops/:coopId/api-key/regenerate`** — Generate/regenerate API key. Requires COOP_ADMIN role. Returns the plaintext key once.

## Exit Guard

In `createSell` and `createTransfer` (registrations.service.ts), applies to the selling/from-shareholder only:

1. Check if shareholder `isEcoPowerClient` and coop has `ecoPowerEnabled`
2. Calculate the shareholder's current portfolio value: sum of `quantity * pricePerShare` for all BUY registrations with status in `[ACTIVE, COMPLETED, PENDING_PAYMENT]` minus all SELL registrations with status in `[PENDING, ACTIVE, COMPLETED]`, scoped to the shareholder and coop
3. Subtract the current sale amount to get the projected remaining value
4. Compare against `ecoPowerMinThreshold`:
   - If `EURO`: compare projected remaining euro value
   - If `SHARES`: compare projected remaining share count
5. If below threshold → throw `BadRequestException`: "Cannot sell: shareholder is an Ecopower client and must maintain at least [threshold]. Current: [current], after sale: [projected]."

Admin can remove the `isEcoPowerClient` flag first if the shareholder has canceled their Ecopower contract, then proceed with the sale.

### Disabling the feature

When a coop sets `ecoPowerEnabled = false`, existing `isEcoPowerClient` flags are preserved but the exit guard stops enforcing. Re-enabling restores enforcement for all flagged shareholders.

## Frontend

### Coop Settings page

- "Ecopower Integration" section (toggle, threshold type, threshold value)
- API key section: show prefix with masked remainder, regenerate button with confirmation dialog

### Shareholder detail page (only visible when `ecoPowerEnabled`)

- Checkbox: "Ecopower client"
- Text field: "Ecopower ID" (optional)

### Shareholder list (only visible when `ecoPowerEnabled`)

- Ecopower client filter/column

### Translations

- All new keys in en, nl, fr, de
