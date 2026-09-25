# Single Source of Truth: Registrations, Payments, and Derived Ownership

**Date:** 2026-03-06
**Status:** Proposed
**Priority:** High (data integrity)

## Problem

We have three overlapping concepts crammed into two tables:

- **`shares`** — denormalized "current state" (ACTIVE, SOLD, TRANSFERRED)
- **`transactions`** — capital events (PURCHASE, SALE) with amounts

Capital calculations drift apart between these tables (993,500 vs 991,500 for the same coop). We've patched calculations to prefer transactions, but the underlying design problem remains.

On top of that, saving shares (spaaraandelen) break the current model entirely: a shareholder registers to buy shares but pays in monthly installments over 12 months. One registration can have 12 bank transactions. Ownership is acquired progressively as payments come in.

## Target Model

Three clean concepts:

### 1. Registration — the intent

A shareholder registers to buy or sell shares. This is the starting point of everything.

```
Registration
  - shareholderId     who
  - coopId            which coop
  - shareClassId      what type of share
  - projectId         which project (nullable)
  - type              BUY or SELL
  - quantity           how many shares
  - pricePerShare     price at time of registration
  - totalAmount       quantity * pricePerShare
  - registerDate      when the registration was made
  - status            PENDING_PAYMENT / ACTIVE / COMPLETED / CANCELLED
  - channelId         which onboarding channel (nullable)
  - processedByUserId who approved it (nullable)
  - processedAt       when it was approved (nullable)
  - rejectionReason   if rejected (nullable)
  - certificateNumber for the share certificate (nullable, set when fully paid)
  - isSavings         whether this is a savings share (12-month installment plan)
```

- `BUY` with `status = ACTIVE` means the shareholder is currently paying (or fully paid)
- `SELL` with `status = COMPLETED` means the shares have been sold back

### 2. Payment — the money

Bank transactions matched to registrations. Multiple payments can match to one registration.

```
Payment
  - registrationId    which registration this payment belongs to
  - coopId            which coop
  - amount            how much was paid (always positive)
  - bankDate          when the bank transaction cleared
  - bankTransactionId link to imported bank statement line (nullable)
  - matchedAt         when the matching happened
  - matchedByUserId   who matched it (nullable, auto or manual)
```

### 3. Ownership — derived, never stored

Ownership is calculated from registrations + payments:

**For a regular (non-savings) buy registration:**
- Share is owned once the full amount is paid: `SUM(payments.amount) >= registration.totalAmount`
- Ownership starts from the date of the last payment that completes the total

**For a savings buy registration (12-month installments):**
- Shares vest progressively: `FLOOR(SUM(payments.amount) / registration.pricePerShare)` = shares owned so far
- Each share vests on the date of the payment that completes it
- Example: 2 shares at €120 each, paying €20/month:
  - After 6 months (€120 paid): 1 share owned
  - After 12 months (€240 paid): 2 shares owned

**For a sell registration:**
- Shares are removed once the coop has paid out: `status = COMPLETED`
- The sell registration references which buy registration(s) it reverses

### How it all fits together

```
Shareholder
  └── Registration (BUY, 2 shares of class A at €120, project Lommel)
        ├── Payment €20 (Jan 2026)
        ├── Payment €20 (Feb 2026)
        ├── Payment €20 (Mar 2026)
        ├── Payment €20 (Apr 2026)
        ├── Payment €20 (May 2026)
        └── Payment €20 (Jun 2026)
        → 6 × €20 = €120 → owns 1 of 2 shares
        ... 6 more payments ...
        → 12 × €20 = €240 → owns 2 of 2 shares

  └── Registration (SELL, 1 share of class A at €120)
        └── Payment €120 (coop pays back)
        → 1 share removed
```

## Schema

```prisma
enum RegistrationType {
  BUY
  SELL
}

enum RegistrationStatus {
  PENDING          // awaiting approval
  PENDING_PAYMENT  // approved, awaiting payment(s)
  ACTIVE           // payments in progress (savings) or fully paid (regular)
  COMPLETED        // fully settled (buy: all shares paid, sell: payout done)
  CANCELLED        // rejected or withdrawn
}

model Registration {
  id                String             @id @default(cuid())
  coopId            String
  shareholderId     String
  shareClassId      String
  projectId         String?
  type              RegistrationType
  status            RegistrationStatus @default(PENDING)
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  // What
  quantity          Int                // number of shares
  pricePerShare     Decimal            @db.Decimal(10, 2)
  totalAmount       Decimal            @db.Decimal(12, 2) // quantity * pricePerShare

  // When
  registerDate      DateTime           // when the shareholder registered

  // Savings shares
  isSavings         Boolean            @default(false)

  // For sells: which buy registration(s) are being reversed
  sellsRegistrationId String?          // links sell to original buy

  // Certificate
  certificateNumber String?

  // Transfer tracking
  fromShareholderId String?            // for transfers: original owner
  toShareholderId   String?            // for transfers: new owner

  // Channel / processing
  channelId         String?
  processedByUserId String?
  processedAt       DateTime?
  rejectionReason   String?

  // OGM for payment matching
  ogmCode           String?            @unique

  // Relations
  coop              Coop               @relation(fields: [coopId], references: [id])
  shareholder       Shareholder        @relation(fields: [shareholderId], references: [id])
  shareClass        ShareClass         @relation(fields: [shareClassId], references: [id])
  project           Project?           @relation(fields: [projectId], references: [id])
  payments          Payment[]
  sellsRegistration Registration?      @relation("SellsBuy", fields: [sellsRegistrationId], references: [id])
  soldBy            Registration[]     @relation("SellsBuy")

  @@map("registrations")
}

model Payment {
  id                String   @id @default(cuid())
  registrationId    String
  coopId            String
  amount            Decimal  @db.Decimal(12, 2)
  bankDate          DateTime
  createdAt         DateTime @default(now())

  // Link to imported bank statement
  bankTransactionId String?  @unique

  // Who matched it
  matchedByUserId   String?
  matchedAt         DateTime?

  // Relations
  registration      Registration @relation(fields: [registrationId], references: [id])
  coop              Coop         @relation(fields: [coopId], references: [id])
  bankTransaction   BankTransaction? @relation(fields: [bankTransactionId], references: [id])

  @@map("payments")
}
```

## Derived Queries

**Total capital for a coop (simple — just sum what's been paid in minus what's been paid out):**
```sql
SELECT COALESCE(
  SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
  0
) AS total_capital
FROM payments p
JOIN registrations r ON r.id = p."registrationId"
WHERE r."coopId" = $1
  AND r.status IN ('ACTIVE', 'COMPLETED')
```

**Shares currently owned by a shareholder:**
```sql
-- For each BUY registration: floor(paid / pricePerShare) shares vested
-- Minus any SELL registrations that completed
SELECT
  r.id,
  r."shareClassId",
  r."projectId",
  r.quantity AS registered_quantity,
  r."pricePerShare",
  LEAST(
    FLOOR(COALESCE(SUM(p.amount), 0) / r."pricePerShare"),
    r.quantity
  ) AS shares_owned
FROM registrations r
LEFT JOIN payments p ON p."registrationId" = r.id
WHERE r."shareholderId" = $1
  AND r."coopId" = $2
  AND r.type = 'BUY'
  AND r.status IN ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED')
GROUP BY r.id
HAVING FLOOR(COALESCE(SUM(p.amount), 0) / r."pricePerShare") > 0
```

Then subtract completed sell registrations.

**Capital at a point in time:**
```sql
SELECT COALESCE(
  SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
  0
)
FROM payments p
JOIN registrations r ON r.id = p."registrationId"
WHERE r."coopId" = $1
  AND r.status IN ('ACTIVE', 'COMPLETED')
  AND p."bankDate" <= $2
```

**Capital by project:**
```sql
SELECT r."projectId", COALESCE(
  SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
  0
) AS capital
FROM payments p
JOIN registrations r ON r.id = p."registrationId"
WHERE r."coopId" = $1
  AND r.status IN ('ACTIVE', 'COMPLETED')
GROUP BY r."projectId"
```

**Savings share progress for a shareholder:**
```sql
SELECT
  r.id,
  r.quantity,
  r."pricePerShare",
  r."totalAmount",
  COALESCE(SUM(p.amount), 0) AS total_paid,
  LEAST(FLOOR(COALESCE(SUM(p.amount), 0) / r."pricePerShare"), r.quantity) AS shares_vested,
  r.quantity - LEAST(FLOOR(COALESCE(SUM(p.amount), 0) / r."pricePerShare"), r.quantity) AS shares_remaining
FROM registrations r
LEFT JOIN payments p ON p."registrationId" = r.id
WHERE r."shareholderId" = $1
  AND r.type = 'BUY'
  AND r."isSavings" = true
  AND r.status IN ('PENDING_PAYMENT', 'ACTIVE')
GROUP BY r.id
```

**When did a specific share vest? (for dividend ex-date calculations):**
```sql
-- For savings shares, each share vests when cumulative payments reach N * pricePerShare
SELECT
  p."bankDate" AS vest_date,
  SUM(p.amount) OVER (ORDER BY p."bankDate") AS cumulative,
  FLOOR(SUM(p.amount) OVER (ORDER BY p."bankDate") / r."pricePerShare") AS shares_at_date
FROM payments p
JOIN registrations r ON r.id = p."registrationId"
WHERE r.id = $1
ORDER BY p."bankDate"
```

## Savings Share Examples

### Example 1: 1 share at €120, paying €10/month
```
Registration: BUY, quantity=1, pricePerShare=120, totalAmount=120, isSavings=true
Payment: Jan €10  → cumulative €10   → 0 shares (10/120 = 0.08, floor = 0)
Payment: Feb €10  → cumulative €20   → 0 shares
...
Payment: Nov €10  → cumulative €110  → 0 shares
Payment: Dec €10  → cumulative €120  → 1 share (120/120 = 1)
Registration status → COMPLETED
```

### Example 2: 2 shares at €120, paying €20/month
```
Registration: BUY, quantity=2, pricePerShare=120, totalAmount=240, isSavings=true
Payment: Jan €20  → cumulative €20   → 0 shares
...
Payment: Jun €20  → cumulative €120  → 1 share (120/120 = 1)
   → shareholder now owns 1 share, certificate can be issued for share 1
Payment: Jul €20  → cumulative €140  → 1 share (140/120 = 1.16, floor = 1)
...
Payment: Dec €20  → cumulative €240  → 2 shares (240/120 = 2)
   → certificate issued for share 2
Registration status → COMPLETED
```

### Example 3: Selling 1 share back
```
Registration: SELL, quantity=1, pricePerShare=120, totalAmount=120
  sellsRegistrationId → points to original BUY registration
  status = PENDING_PAYMENT (awaiting coop payout)

Payment: €120 (coop pays shareholder back)
  → Registration status → COMPLETED
  → Capital reduced by €120
```

## What Gets Deleted

| Current | Replacement |
|---|---|
| `Share` model | Gone. Ownership derived from Registration + Payment. |
| `Transaction` model | Renamed/refactored to `Registration` |
| `shares` table | Dropped |
| `transactions` table | Migrated to `registrations` |
| `ShareStatus` enum | Gone |
| `TransactionType` enum | Replaced by `RegistrationType` (BUY/SELL) |
| `TransactionStatus` enum | Replaced by `RegistrationStatus` |
| `payment` table (current) | Repurposed/merged into new `Payment` model |

## What Stays the Same

- `Shareholder` model — unchanged
- `ShareClass` model — unchanged (defines types of shares, price, rules)
- `Project` model — unchanged
- `BankTransaction` model — unchanged (imported bank statement lines)
- `DividendPeriod` / `DividendPayout` — updated to use registrations for eligibility
- All frontend pages — updated to use new API responses

## Migration Strategy

### Phase 1: Add Registration + Payment models alongside existing tables

1. Create `registrations` and `payments` tables
2. Backfill registrations from existing transactions (1:1 mapping)
3. Backfill payments from existing shares (paymentDate → single payment per registration)
4. For Bronsgroen savings shares: reconstruct installment payments from bank import history
5. Validate: `SUM(payments)` per registration matches expected amounts

### Phase 2: Dual-write

1. Every purchase/sale creates both old (Transaction + Share) and new (Registration + Payment)
2. Run consistency checks comparing old vs new
3. Fix any discrepancies

### Phase 3: Migrate all reads to new model

Module by module, replace queries:

| Module | Complexity | Notes |
|--------|-----------|-------|
| Admin stats / KPI | Low | SUM(payments) with JOIN |
| Analytics charts | Low | Already transaction-based, just change table |
| Reports | Low | Same queries, different table |
| Public stats | Medium | Capital by project, shareholder counts |
| Shareholder list | Medium | Derive ownership from registrations + payments |
| "My shares" page | Medium | Show registrations with payment progress |
| Dividend calculation | High | Need shares vested on ex-dividend date |
| Certificate generation | Medium | Issue when share vests |
| Sale flow | High | Create SELL registration, match payout payment |
| Purchase flow | High | Create BUY registration, match incoming payments |
| Bank import matching | High | Match bank lines → payments on registrations |
| Seed scripts | Medium | Create registrations + payments instead of shares |

### Phase 4: Drop old tables

1. Remove `Share` and `Transaction` models from schema
2. Drop `shares` and `transactions` tables
3. Delete `shares.service.ts`, `shares.module.ts`
4. Rename references throughout codebase

### Phase 5: Savings share UI

New frontend features enabled by this model:
- Savings share registration flow (choose installment plan)
- Payment progress bar per registration
- "X of Y shares vested" display
- Monthly payment reminders
- Automatic OGM generation for recurring payments

## Affected Files

### Backend API
- `modules/shares/` — **DELETE entirely**
- `modules/transactions/` — **MAJOR REWRITE** → becomes `modules/registrations/`
- `modules/payments/` — **REWRITE** to handle new Payment model
- `modules/bank-import/` — update matching to create Payment records
- `modules/shareholders/` — derive shares from registrations
- `modules/dividends/` — use vesting dates for eligibility
- `modules/documents/` — certificate on vesting, not on share creation
- `modules/admin/` — update stats, analytics, reports
- `modules/coops/` — update public stats
- `modules/system/` — update cross-coop stats
- `modules/mcp/` — update API tools

### Database
- `schema.prisma` — new Registration + Payment models, drop Share + Transaction
- `seed.ts` / `seed-demo.ts` — create registrations + payments
- Migration scripts for production data

### Frontend
- Shareholder dashboard — show registration progress
- Shares page — registrations with payment status
- Admin transactions page — registrations with payments
- Sale dialog — create sell registration
- Bank import — match to registration payments

## Risks & Mitigations

1. **Data migration complexity** — Bronsgroen has savings shares with complex payment histories. Mitigation: test migration against production backup, validate totals match.

2. **Dividend vesting dates** — Need to determine exactly when each share vested (which payment completed it). Mitigation: window function query on cumulative payments.

3. **Performance** — Ownership is now a JOIN + aggregate instead of a status check. Mitigation: create a database view or materialized view for "current ownership" if needed. Add indexes on `registrationId`, `bankDate`.

4. **Partial payments** — What if someone pays €15 instead of €10? The floor logic handles this naturally — they just vest shares slower/faster.

5. **Overpayments** — What if someone pays more than totalAmount? Cap vested shares at `registration.quantity`. Excess flagged for admin review.

## Future Refactor: Identity Per Registration

Currently shareholders are a separate model, and registrations just link to them. But every share purchase involves a beneficial owner who may differ from the logged-in user:

- **Self** — buying for yourself (existing shareholder, info already on file)
- **Company** — buying for a legal entity (company name, KBO number, VAT, etc.)
- **Underage family member** — registered by parent/guardian (child's name, birth date)
- **Gift certificate** — until claimed, the buyer is the owner

The principle: **every registration must carry the identifiable information of the beneficial owner at time of purchase.** For existing logged-in shareholders buying for themselves, this is pre-filled. For new shareholders or people buying for others, this must be collected during the registration flow.

This is a separate refactor because it changes the registration/onboarding UX, not the data model. The Registration model should be designed with a `beneficialOwner` JSON field or a relation to accommodate this later without another schema migration.

**Deferred to a follow-up refactor after the data model is stable.**

## Estimated Effort

- Phase 1 (new tables + backfill): 1-2 sessions
- Phase 2 (dual-write): 1 session
- Phase 3 (migrate reads): 3-4 sessions
- Phase 4 (drop old tables): 1 session
- Phase 5 (savings share UI): 2-3 sessions

Total: ~8-10 sessions. Each phase is independently deployable.
