# Charge Cards v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shareholders of a coop with charge cards turned on request EV charging cards and pay a one-time fee by OGM bank transfer, and let coop admins issue, block and track those cards, without any provider integration.

**Architecture:** One per-coop OGM counter (`Coop.ogmSequence`) feeds registrations and charge cards. `Payment` becomes generic (a registration or a charge card, enforced by a CHECK constraint), and one `OgmService` resolves OGMs to a `PaymentTarget` for `BankMatchingService` (the shared matcher behind CSV import, Ponto and rematch, on main since v2026.39.4); manual match looks a card up through the same service. A new `charge-cards` NestJS module holds the shareholder and admin endpoints; a state-based `ChargeCardSyncService` keeps cards in line with shareholder status (nightly and on every `recompute()`). The web app gets a shareholder page, an admin page, a settings section, and a post-login redirect so a deep link survives login.

**Tech Stack:** NestJS 10, Prisma 6, PostgreSQL 16, Jest 29 + ts-jest (unit specs with mocked Prisma, plus `*.db.spec.ts` specs against the test Postgres), Next.js 15 App Router, React 18, next-intl, Playwright.

**Spec:** `docs/plans/2026-10-05-charge-cards-design.md`, plus the coordinator's 2026-10-05 changes: fees are set incl. VAT (`chargeCardFee` 6.00, `chargeCardReplacementFee` 12.00, `chargeCardVatRate` 21 stored for later invoicing), `ChargeCard.feeInclVat` and `isReplacement` frozen at request time, a LOST card can be replaced once, admin list shows waiting time and flags cards older than 5 working days, no UNPAID reason, no yearly cleanup, no roaming, no invoices.

**Base:** updated on 2026-10-05 against `main` 4e6b2840 (plan first written against d5dc546c). Since then main shipped `extractOgmCode` in `@opencoop/shared`, `BankMatchingService`, the Ponto OGM-format fix, the coop-scoped manual match, `MatchBankTransactionDto`, the `IGNORED` match status and the link-to-existing-payment flow. Task 3 and Task 5 build on those instead of re-doing them. Preflight notes: `.superpowers/sdd/2026-10-05-charge-cards-plan/preflight.md`.

## Global Constraints

- **v1 only.** Out of scope: the external charge-card API (`GET /external/charge-cards`, `POST /external/charge-cards/usage`), the INACTIVITY daily-job logic, `lastUsedAt`, `chargeCardInactivityMonths`, the `UNPAID` block reason, the yearly cleanup, roaming, VAT invoices.
- **`lastUsedAt` and `INACTIVITY` stay out of the schema.** Adding them in v2 is one `ALTER TABLE "charge_cards" ADD COLUMN "lastUsedAt" TIMESTAMP(3)` and one `ALTER TYPE "ChargeCardBlockReason" ADD VALUE 'INACTIVITY'`. Leaving them in buys nothing.
- **`activatedAt` stays.** OpenCoop sets it on issue, on a re-enable request, and on every unblock.
- **Fees are incl. VAT.** `Coop.chargeCardFee Decimal(12,2) @default(6.00)`, `Coop.chargeCardReplacementFee Decimal(12,2) @default(12.00)`, `Coop.chargeCardVatRate Decimal(5,2) @default(21)`. v1 stores the VAT rate and never computes with it. `ChargeCard.feeInclVat` is frozen at request time.
- **Replacement:** a request may name one of the shareholder's own `BLOCKED`/`LOST` cards in `replacesCardId`. It then costs `chargeCardReplacementFee` and carries `isReplacement = true`. `replacesCardId` is `@unique`, so a LOST card is replaced once at most.
- **Payment acceptance:** a card accepts a payment only in `REQUESTED`. CSV import and Ponto auto-match a card only when the amount is at least `feeInclVat` (compared in cents). Shorter payments and payments for `PAID`, `ACTIVE`, `BLOCKED` or `CANCELLED` cards stay `UNMATCHED`. A manual match on a `REQUESTED` card records any amount; the card becomes `PAID` when its payments add up to `feeInclVat`.
- **Overdue:** a `REQUESTED` card older than 5 working days since `requestedAt`, or a `PAID` card older than 5 working days since `paidAt`. Working days are Monday to Friday, counted on UTC calendar dates, holidays ignored.
- **Feature gate:** `Coop.chargeCardsEnabled Boolean @default(false)`, edited in admin settings exactly like `ecoPowerEnabled`.
- **Admin permission:** the admin charge-card endpoints and page use the existing `canManageShareholders` permission. No new permission column.
- **Strings:** every user-facing web string goes in a new top-level `chargeCards` namespace in `apps/web/messages/{en,nl,fr,de}.json`. Every email has copy in `apps/api/src/modules/email/i18n/{nl,en,fr,de}.json`.
- **Do not rewrite the web message files with `JSON.stringify`.** `en.json` contains duplicate keys (`meetings.convocation` twice), so a parse-and-dump rewrites unrelated content. The plan inserts the new namespace as text.
- **Formatting:** currency through `formatCurrency(amount, locale)` from `@opencoop/shared` with `useLocale()`; dates through `toLocaleDateString(locale)`.
- **Web pages copy their siblings** (`tasks/lessons.md`, 2026-04-14): `'use client'`, `useTranslations()`, the `api()` helper, `useAdmin()`, `Link` from `@/i18n/routing`. Never `use(params)`.
- **Migrations are hand-written** in fixed folders and proven with `prisma migrate diff --exit-code` against `schema.prisma`. CI's e2e job builds its DB with `prisma db push`, which never runs migration SQL. The CHECK constraint and the OGM backfill run only in production (`prisma migrate deploy`) and in the `*.db.spec.ts` specs, which build their DB with `prisma migrate deploy` followed by `prisma db push` (see "Rebuild the test DB" below).
- **The migration history does not replay to the current schema.** On an empty DB, the 43 existing migrations apply cleanly, but `migrate diff` still reports a pre-existing baseline drift: `coops` lacks the Ecopower and API-key columns, `shareholders` lacks `ecoPowerId`/`isEcoPowerClient`, `registrations` lacks the gift columns, plus `webauthn_credentials`, `refresh_tokens` and `audit_logs`. On such a DB, `prisma.coop.create` fails with "The column `ecoPowerEnabled` does not exist". Production must have these columns, since the app reads them, so they came from outside the migration history (not checked on prod). So the DB specs run `migrate deploy` (our migration SQL, CHECK and backfill included) and then `db push` (fills the old drift; it keeps CHECK constraints). Repairing the old history is out of scope.
- **Do not use `prisma migrate reset`.** Prisma 6 refuses it from an AI agent unless the user's own consent text is passed in an environment variable, and it would not fix the drift anyway. The test container keeps its data on tmpfs, so `--force-recreate` gives an empty test DB. Only ever recreate `postgres-test` from `docker-compose.test.yml` (port 5433), never another database.
- **Test layers:** unit specs mock Prisma (the existing style). `*.db.spec.ts` specs use `describeDb`, which skips unless `TEST_DATABASE_URL` is set, so `pnpm --filter @opencoop/api test` stays green in CI without a database. Run DB specs with `--runInBand`.
- **Stale artifacts:** `apps/api/tsconfig.json` has `"incremental": true`. If `tsc` replays an error you already fixed, delete `apps/api/tsconfig.tsbuildinfo` and `apps/api/dist` and rerun before you debug.
- **Untracked compiled files** (`*.js`, `*.d.ts`) sit next to many sources in `apps/api/src` and `apps/web/src`. Stage explicit paths only. Never `git add -A` or `git add .`.
- **Build before each commit that changes types** (`tasks/lessons.md`, 2026-02-23): `pnpm --filter @opencoop/api build` for API tasks, `pnpm --filter @opencoop/web build` for web tasks.
- **Out of bounds:** `.github/workflows/*`, `deploy/*`, `docker-compose*.yml`.

## One-time Setup

Run these before Task 1. They start the test Postgres on port 5433, create a shadow DB for `migrate diff`, and record the migration baseline.

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
pnpm install
pnpm db:generate
pnpm --filter "@opencoop/api^..." build
docker compose -f docker-compose.test.yml up -d --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
```

Expected: the last command prints nothing. On a rerun it prints `database "opencoop_shadow" already exists`; that is fine. Run Docker through Colima (`colima status` says running). Compose names the project after the folder, so a test container started from the main checkout (`opencoop-postgres-test-1`) also binds port 5433: stop it first. Preflight baseline on 4e6b2840: `pnpm --filter @opencoop/api test` passes, 68 suites, 788 tests.

Record the baseline drift between the existing migrations and the schema:

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards/packages/database
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://opencoop:opencoop@localhost:5433/opencoop_shadow \
  --exit-code
echo "exit=$?"
```

Expected: `exit=2`. On 4e6b2840 the baseline drift is known (see Global Constraints: Ecopower, API-key and gift columns, `webauthn_credentials`, `refresh_tokens`, `audit_logs`). Rerun with `--script` instead of `--exit-code`, save the output to `tasks/charge-cards-baseline-drift.sql`, and compare against it in every later `migrate diff` step: only new statements count, and every later "Expected: `exit=0`" means "no statements beyond the baseline". If you get `exit=1`, the shadow DB is unreachable; fix that before you start.

Rebuild the test DB (an empty DB, all migrations, then the baseline drift):

```bash
docker compose -f docker-compose.test.yml up -d --force-recreate --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma db push --skip-generate --accept-data-loss
```

Expected: `migrate deploy` ends with `All migrations have been successfully applied.` and lists every folder in `prisma/migrations`; `db push` ends with `Your database is now in sync with your Prisma schema`. Its data-loss warnings name only two unique indexes (`coops.apiKeyHash`, `registrations.giftCode`) on empty tables. Preflight ran these four lines on 4e6b2840: 43 migrations applied, and a `coop`/`shareholder`/`shareClass`/`registration` create worked afterwards. `db push` keeps CHECK constraints it does not know (checked with a probe constraint).

Commands used throughout:

| Purpose | Command (from repo root) |
|---|---|
| One API spec file or folder | `pnpm --filter @opencoop/api exec jest <path-fragment>` |
| All API unit specs | `pnpm --filter @opencoop/api test` |
| Rebuild the test DB from migrations | the four lines under "Rebuild the test DB" above |
| DB-backed specs | `TEST_DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/api exec jest --runInBand db.spec` |
| API build / lint | `pnpm --filter @opencoop/api build` / `pnpm --filter @opencoop/api lint` |
| Web build / lint | `pnpm --filter @opencoop/web build` / `pnpm --filter @opencoop/web exec next lint` |
| e2e DB (after DB specs, it re-seeds) | `pnpm test:e2e:setup` |
| One e2e spec | `cd e2e && npx playwright test <spec path>` |

The e2e setup runs `db push` and the seed against the same test DB the DB specs rebuild. Run DB specs first and `pnpm test:e2e:setup` after them, never the other way round. A DB that went through `db push` with a newer schema cannot take the new migration any more (`column already exists`), so always rebuild it before the DB specs. Because `db push` never runs migration SQL, the e2e DB does not have the `payments_exactly_one_target_check` CHECK constraint — an e2e test cannot rely on the database itself rejecting a payment with both or neither target set.

## Review Focus

1. **A shareholder pays the card fee twice** (two transfers, same OGM). The first payment moves the card to `PAID`; the second stays `UNMATCHED` with no second `Payment` row, so an admin can refund it. Pinned in Task 5 (`bank-matching.service.spec.ts`, "second transfer for a paid card stays UNMATCHED").
2. **The OGM arrives in another shape**: digits only from Ponto, `***` instead of `+++`, spaces. Main already normalises these with `extractOgmCode` (`packages/shared/src/utils.ts`, specs in `utils.spec.ts`); a reference that is exactly 12 valid digits matches, 12 digits inside free text (an IBAN, a sentence) never do. Task 3 routes every OGM lookup through `OgmService`, which normalises with the same function, so a charge-card OGM gets the same treatment. Pinned in Task 3 (`ogm.service.spec.ts`).
3. **An admin types a card number with spaces, or a number already used in the coop.** OpenCoop trims it, and a duplicate returns `409 Conflict` instead of a 500. Pinned in Task 6 (`charge-cards-admin.service.spec.ts`).
4. **An admin issues a `PAID` card after the shareholder sold all shares.** OpenCoop refuses, because the nightly job would block the card at once and the provider would bill for it. Pinned in Task 6.
5. **The shareholder status flaps** (sells, then buys again before the provider change is made). The card goes `BLOCKED` then back to `ACTIVE`, and `providerSyncNeeded` stays `true`, so the admin still checks the portal. Pinned in Task 7 (`charge-card-sync.db.spec.ts`).

---

### Task 1: Shared per-coop OGM counter

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `Coop`, after the `ogmPrefix` line)
- Create: `packages/database/prisma/migrations/20261005100000_coop_ogm_sequence/migration.sql`
- Create: `apps/api/src/modules/ogm/ogm.ts`
- Create: `apps/api/src/modules/ogm/ogm.service.ts`
- Create: `apps/api/src/modules/ogm/ogm.module.ts`
- Create: `apps/api/src/modules/ogm/ogm.service.spec.ts`
- Create: `apps/api/src/test-utils/test-db.ts`
- Create: `apps/api/src/modules/ogm/ogm.db.spec.ts`
- Modify: `apps/api/src/modules/registrations/registrations.service.ts:1-19` (imports, constructor) and `:353-370` (`createBuy` OGM block)
- Modify: `apps/api/src/modules/registrations/registrations.module.ts`
- Modify: `apps/api/src/modules/registrations/registrations.service.spec.ts:16-51` (providers) and append a `describe`
- Modify: `apps/api/src/modules/registrations/registrations.lifecycle.spec.ts:48-55` (providers)
- Modify: `packages/database/prisma/seed.ts:400-440`, `packages/database/prisma/seed-demo.ts:461-500` (set the counter after seeding registrations)

**Interfaces:**
- Consumes: `generateOgmCode(prefix: string, sequence: number): string` from `@opencoop/shared`.
- Produces:
  - `Coop.ogmSequence Int @default(0)` — the last sequence handed out.
  - `MAX_OGM_SEQUENCE = 9_999_999` in `apps/api/src/modules/ogm/ogm.ts`.
  - `OgmService.nextOgmCode(db: Prisma.TransactionClient, coopId: string): Promise<string>` — atomic `UPDATE ... RETURNING`, returns a formatted `+++xxx/xxxx/xxxxx+++` code.
  - `OgmModule` (exports `OgmService`).
  - `apps/api/src/test-utils/test-db.ts`: `describeDb`, `createTestPrisma()`, `createTestCoop(prisma)`, `createTestShareholder(prisma, coopId, status?)`, `createTestShareClass(prisma, coopId)`, `cleanupTestCoops(prisma)`.

- [ ] **Step 1: Write the failing unit test for `nextOgmCode`**

Create `apps/api/src/modules/ogm/ogm.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import { MAX_OGM_SEQUENCE } from './ogm';

describe('OgmService.nextOgmCode', () => {
  const service = new OgmService({} as any);

  it('returns the OGM for the incremented sequence with the coop prefix', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: 42 }]) };

    await expect(service.nextOgmCode(db as any, 'coop-1')).resolves.toBe(generateOgmCode('001', 42));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException for an unknown coop', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(service.nextOgmCode(db as any, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('refuses a sequence that no longer fits in 7 digits', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ ogmPrefix: '001', ogmSequence: MAX_OGM_SEQUENCE + 1 }]),
    };

    await expect(service.nextOgmCode(db as any, 'coop-1')).rejects.toThrow(/exhausted/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/ogm.service.spec`
Expected: FAIL with `Cannot find module './ogm.service'`.

- [ ] **Step 3: Add the schema field**

In `packages/database/prisma/schema.prisma`, model `Coop`, directly below the line `ogmPrefix            String    @unique // Unique prefix for OGM codes (e.g., "001")`, add:

```prisma
  ogmSequence          Int       @default(0) // last OGM sequence handed out (registrations + charge cards)
```

Then run: `pnpm db:generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 4: Write the OGM module**

Create `apps/api/src/modules/ogm/ogm.ts`:

```ts
/** The OGM body is prefix (3 digits) + sequence (7 digits) + check (2 digits). */
export const MAX_OGM_SEQUENCE = 9_999_999;
```

Create `apps/api/src/modules/ogm/ogm.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_OGM_SEQUENCE } from './ogm';

@Injectable()
export class OgmService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hands out the next OGM of a coop. One atomic UPDATE ... RETURNING on the
   * coop row, so concurrent callers never get the same sequence. Registrations
   * and charge cards share this counter, so their codes never collide.
   */
  async nextOgmCode(db: Prisma.TransactionClient, coopId: string): Promise<string> {
    const rows = await db.$queryRaw<{ ogmPrefix: string; ogmSequence: number }[]>`
      UPDATE "coops" SET "ogmSequence" = "ogmSequence" + 1
      WHERE "id" = ${coopId}
      RETURNING "ogmPrefix", "ogmSequence"`;
    if (rows.length === 0) {
      throw new NotFoundException('Cooperative not found');
    }
    const { ogmPrefix, ogmSequence } = rows[0];
    if (ogmSequence > MAX_OGM_SEQUENCE) {
      throw new Error(`OGM sequence exhausted for coop ${coopId}`);
    }
    return generateOgmCode(ogmPrefix, ogmSequence);
  }
}
```

Create `apps/api/src/modules/ogm/ogm.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OgmService } from './ogm.service';

@Module({
  providers: [OgmService],
  exports: [OgmService],
})
export class OgmModule {}
```

- [ ] **Step 5: Run the unit test and watch it pass**

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/ogm.service.spec`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing registrations test**

In `apps/api/src/modules/registrations/registrations.service.spec.ts`:

1. Add the import below the `ShareholderStatusService` import:

```ts
import { OgmService } from '../ogm/ogm.service';
import { generateOgmCode } from '@opencoop/shared';
```

2. Below `let emailService: any;` add `let ogm: { nextOgmCode: jest.Mock };`.
3. At the start of `beforeEach`, add `ogm = { nextOgmCode: jest.fn() };`.
4. Replace the provider line `{ provide: AdminNotificationsService, useValue: {} },` with:

```ts
        {
          provide: AdminNotificationsService,
          useValue: { notifyAdminsOnEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OgmService, useValue: ogm },
```

5. Append this block before the final `});` of the file:

```ts
  describe('createBuy — OGM from the shared coop counter', () => {
    it('takes the OGM from OgmService inside the create transaction, not from a registration count', async () => {
      const ogmCode = generateOgmCode('001', 7);
      prisma.shareClass = {
        findFirst: jest.fn().mockResolvedValue({ id: 'sc-1', name: 'A', pricePerShare: 25 }),
      };
      prisma.shareholder = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sh-1', firstName: 'Jan', lastName: 'Peeters', companyName: null, email: null, user: null,
        }),
      };
      prisma.coop.findUnique.mockResolvedValue({
        ogmPrefix: '001', requiresApproval: false, emailEnabled: false, bankIban: null, bankBic: null,
      });
      const tx = {
        registration: {
          count: jest.fn().mockResolvedValue(99),
          create: jest.fn().mockResolvedValue({ id: 'reg-1', ogmCode }),
        },
      };
      prisma.$transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
      prisma.registration.count.mockResolvedValue(1);
      ogm.nextOgmCode.mockResolvedValue(ogmCode);

      await service.createBuy({ coopId: 'coop-1', shareholderId: 'sh-1', shareClassId: 'sc-1', quantity: 1 });

      expect(ogm.nextOgmCode).toHaveBeenCalledWith(tx, 'coop-1');
      expect(tx.registration.count).not.toHaveBeenCalled();
      expect(tx.registration.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ogmCode }) }),
      );
    });
  });
```

In `apps/api/src/modules/registrations/registrations.lifecycle.spec.ts`, add `import { OgmService } from '../ogm/ogm.service';` to the imports and add `{ provide: OgmService, useValue: { nextOgmCode: jest.fn() } },` to the `providers` array.

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter @opencoop/api exec jest src/modules/registrations`
Expected: FAIL in "takes the OGM from OgmService…": `expect(jest.fn()).toHaveBeenCalledWith(...)` — `nextOgmCode` was never called, because `createBuy` still counts registrations.

- [ ] **Step 8: Use the counter in `createBuy`**

In `apps/api/src/modules/registrations/registrations.service.ts`:

1. Change line 3 to `import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';`.
2. Add `import { OgmService } from '../ogm/ogm.service';` below the `ShareholderStatusService` import.
3. Add `private ogm: OgmService,` as the last constructor parameter (after `private shareholderStatus: ShareholderStatusService,`).
4. In `createBuy`, change the coop select from `{ ogmPrefix: true, requiresApproval: true, emailEnabled: true, bankIban: true, bankBic: true }` to `{ requiresApproval: true, emailEnabled: true, bankIban: true, bankBic: true }`.
5. Replace:

```ts
    // I2: Wrap count+create in transaction for OGM uniqueness
    const registration = await this.prisma.$transaction(async (tx) => {
      const registrationCount = await tx.registration.count({
        where: { coopId: data.coopId },
      });
      const ogmCode = generateOgmCode(coop.ogmPrefix, registrationCount + 1);
```

with:

```ts
    // The OGM comes from the coop's shared counter (registrations + charge cards).
    const registration = await this.prisma.$transaction(async (tx) => {
      const ogmCode = await this.ogm.nextOgmCode(tx, data.coopId);
```

In `apps/api/src/modules/registrations/registrations.module.ts`, add `import { OgmModule } from '../ogm/ogm.module';` and add `OgmModule,` to the `imports` array after `ShareholderStatusModule,`.

- [ ] **Step 9: Run the registrations specs and watch them pass**

Run: `pnpm --filter @opencoop/api exec jest src/modules/registrations src/modules/ogm`
Expected: PASS, all tests.

- [ ] **Step 10: Write the migration**

Create `packages/database/prisma/migrations/20261005100000_coop_ogm_sequence/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "coops" ADD COLUMN "ogmSequence" INTEGER NOT NULL DEFAULT 0;

-- Initialise the counter from the highest sequence already handed out per
-- coop, parsed from the stored OGM codes (digits 4-10 of the 12-digit body).
-- Not from a count: deleted or imported registrations leave gaps and
-- out-of-order codes. GREATEST keeps a re-run from lowering a live counter.
-- The DB spec executes everything below this marker.
-- BACKFILL
UPDATE "coops" c
SET "ogmSequence" = GREATEST(c."ogmSequence", s.max_seq)
FROM (
  SELECT c2."id" AS coop_id,
         MAX(SUBSTRING(regexp_replace(r."ogmCode", '\D', '', 'g') FROM 4 FOR 7)::INTEGER) AS max_seq
  FROM "coops" c2
  JOIN "registrations" r
    ON r."ogmCode" IS NOT NULL
   AND length(regexp_replace(r."ogmCode", '\D', '', 'g')) = 12
   AND LEFT(regexp_replace(r."ogmCode", '\D', '', 'g'), 3) = c2."ogmPrefix"
  GROUP BY c2."id"
) s
WHERE s.coop_id = c."id";
```

The join matches on the prefix, not on `coopId`. The `ogmCode` column is globally unique, so any code with this coop's prefix blocks that sequence, whichever coop row holds it.

- [ ] **Step 11: Prove the migration matches the schema**

Run from `packages/database`:

```bash
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://opencoop:opencoop@localhost:5433/opencoop_shadow \
  --exit-code
echo "exit=$?"
```

Expected: `exit=2` from the known baseline only. Rerun with `--script` instead of `--exit-code` and compare with `tasks/charge-cards-baseline-drift.sql` (`diff <(pnpm exec prisma migrate diff ... --script) ../../tasks/charge-cards-baseline-drift.sql`). Any statement that is not in the baseline is SQL Prisma still wants from this migration; fix `migration.sql` until the two outputs are equal.

- [ ] **Step 12: Write the DB helper and the failing DB spec**

Create `apps/api/src/test-utils/test-db.ts`:

```ts
import { PrismaClient, ShareholderStatus } from '@opencoop/database';

/**
 * Helpers for *.db.spec.ts files. They run against the test Postgres
 * (docker-compose.test.yml, port 5433) after `prisma migrate deploy` + `db push`, and
 * skip when TEST_DATABASE_URL is not set (CI unit job, plain `pnpm test`).
 */
const url = process.env.TEST_DATABASE_URL;
const SLUG_PREFIX = 'dbtest-';
let counter = 0;

export const describeDb = url ? describe : describe.skip;

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: url });
}

export async function createTestCoop(prisma: PrismaClient) {
  counter += 1;
  const taken = new Set((await prisma.coop.findMany({ select: { ogmPrefix: true } })).map((c) => c.ogmPrefix));
  let prefix = 900;
  while (taken.has(String(prefix))) prefix += 1;
  return prisma.coop.create({
    data: { slug: `${SLUG_PREFIX}${Date.now()}-${counter}`, name: 'DB test coop', ogmPrefix: String(prefix) },
  });
}

export async function createTestShareholder(
  prisma: PrismaClient,
  coopId: string,
  status: ShareholderStatus = 'ACTIVE',
) {
  return prisma.shareholder.create({
    data: { coopId, type: 'INDIVIDUAL', status, firstName: 'Db', lastName: 'Test' },
  });
}

export async function createTestShareClass(prisma: PrismaClient, coopId: string) {
  return prisma.shareClass.create({ data: { coopId, name: 'A', code: 'A', pricePerShare: 10 } });
}

export async function cleanupTestCoops(prisma: PrismaClient) {
  const inTestCoop = { coop: { slug: { startsWith: SLUG_PREFIX } } };
  await prisma.payment.deleteMany({ where: inTestCoop });
  await prisma.registration.deleteMany({ where: inTestCoop });
  await prisma.coop.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
}
```

Create `apps/api/src/modules/ogm/ogm.db.spec.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import {
  cleanupTestCoops,
  createTestCoop,
  createTestPrisma,
  createTestShareClass,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

const MIGRATION = path.resolve(
  __dirname,
  '../../../../../packages/database/prisma/migrations/20261005100000_coop_ogm_sequence/migration.sql',
);

describeDb('OGM sequence (database)', () => {
  let prisma: PrismaClient;
  let ogm: OgmService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    ogm = new OgmService(prisma as any);
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('hands out 25 distinct, consecutive codes when called concurrently', async () => {
    const coop = await createTestCoop(prisma);

    const codes = await Promise.all(
      Array.from({ length: 25 }, () => prisma.$transaction((tx) => ogm.nextOgmCode(tx, coop.id))),
    );

    expect(new Set(codes).size).toBe(25);
    const expected = Array.from({ length: 25 }, (_, i) => generateOgmCode(coop.ogmPrefix, i + 1));
    expect([...codes].sort()).toEqual(expected.sort());
    const after = await prisma.coop.findUniqueOrThrow({ where: { id: coop.id } });
    expect(after.ogmSequence).toBe(25);
  });

  it('backfills the counter from the highest parsed sequence, not from the registration count', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    for (const sequence of [3, 17, 9]) {
      await prisma.registration.create({
        data: {
          coopId: coop.id,
          shareholderId: shareholder.id,
          shareClassId: shareClass.id,
          type: 'BUY',
          quantity: 1,
          pricePerShare: 10,
          totalAmount: 10,
          registerDate: new Date(),
          ogmCode: generateOgmCode(coop.ogmPrefix, sequence),
        },
      });
    }

    const backfill = fs.readFileSync(MIGRATION, 'utf-8').split('-- BACKFILL')[1];
    await prisma.$executeRawUnsafe(backfill);

    const after = await prisma.coop.findUniqueOrThrow({ where: { id: coop.id } });
    expect(after.ogmSequence).toBe(17);
    await expect(prisma.$transaction((tx) => ogm.nextOgmCode(tx, coop.id))).resolves.toBe(
      generateOgmCode(coop.ogmPrefix, 18),
    );
  });
});
```

- [ ] **Step 13: Run the DB spec against a migrated DB**

```bash
docker compose -f docker-compose.test.yml up -d --force-recreate --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma db push --skip-generate --accept-data-loss
TEST_DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/api exec jest --runInBand src/modules/ogm/ogm.db.spec
```

Expected: `migrate deploy` lists `20261005100000_coop_ogm_sequence` as applied and ends with `All migrations have been successfully applied.`; `db push` reports the DB in sync. The spec PASSES, 2 tests. If `migrate deploy` fails on the new migration, fix the migration; if it fails on an older one, stop and report a blocker.

Then confirm the spec skips without the variable:
Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/ogm.db.spec`
Expected: `Tests: 2 skipped`.

- [ ] **Step 14: Keep the seeds in step with the counter**

The e2e seeds write OGM codes 1..N directly. Without a counter update, the first registration created in e2e would collide with a seeded code.

In `packages/database/prisma/seed.ts`, inside `await prisma.$transaction(async (tx) => {`, directly after the closing `}` of `for (let i = 0; i < buys.length; i++) { ... }`, add:

```ts
      // The seed writes OGM sequences 1..buys.length; move the counter past them.
      await tx.coop.update({ where: { id: coop!.id }, data: { ogmSequence: buys.length } });
```

Make the same change in `packages/database/prisma/seed-demo.ts` at the same place (after the `for` loop over `buys`, inside its `$transaction`).

Run: `pnpm --filter @opencoop/database exec tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0.

- [ ] **Step 15: Build, run all API specs, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
```

Expected: build exits 0; all suites pass, the 2 DB tests show as skipped.

```bash
git add packages/database/prisma/schema.prisma \
  packages/database/prisma/migrations/20261005100000_coop_ogm_sequence/migration.sql \
  packages/database/prisma/seed.ts packages/database/prisma/seed-demo.ts \
  apps/api/src/modules/ogm/ogm.ts apps/api/src/modules/ogm/ogm.service.ts \
  apps/api/src/modules/ogm/ogm.module.ts apps/api/src/modules/ogm/ogm.service.spec.ts \
  apps/api/src/modules/ogm/ogm.db.spec.ts apps/api/src/test-utils/test-db.ts \
  apps/api/src/modules/registrations/registrations.service.ts \
  apps/api/src/modules/registrations/registrations.module.ts \
  apps/api/src/modules/registrations/registrations.service.spec.ts \
  apps/api/src/modules/registrations/registrations.lifecycle.spec.ts
git commit -m "feat(ogm): hand out OGM codes from one atomic per-coop counter"
```

---

### Task 2: Generic Payment and the ChargeCard schema

The `chargeCardId` foreign key needs the `charge_cards` table, so the whole charge-card schema (model, enums, coop fields) lands here. Task 4 adds the API on top.

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enums after `AdminNotificationFrequency`, model `Coop`, model `Shareholder`, model `Payment`, new model `ChargeCard` after `Payment`)
- Create: `packages/database/prisma/migrations/20261005110000_charge_cards/migration.sql`
- Modify: `apps/api/src/modules/admin-notifications/admin-notifications.service.ts:173-188`
- Create: `apps/api/src/modules/admin-notifications/admin-notifications.service.spec.ts`
- Modify: `apps/api/src/modules/bank-import/bank-import.service.ts:41-57` (`getTransactions` include)
- Modify: `apps/api/src/modules/bank-import/bank-import.service.spec.ts` (append one test)
- Modify: `apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx:45-67` and `:412`
- Modify: `apps/api/src/modules/payments/payments.service.ts` (`findUnlinkedByCoopId`), `apps/api/src/modules/payments/payments.service.spec.ts` (append one test)
- Modify: `apps/api/src/test-utils/test-db.ts` (add `createTestChargeCard`)
- Create: `apps/api/src/modules/payments/payments.db.spec.ts`

**Interfaces:**
- Consumes: Task 1 test helpers.
- Produces:
  - Enums `ChargeCardStatus { REQUESTED PAID ACTIVE BLOCKED CANCELLED }`, `ChargeCardBlockReason { NO_SHARES LOST ADMIN }`.
  - Model `ChargeCard` with fields `id, coopId, shareholderId, label, status, blockReason, ogmCode, cardNumber, feeInclVat, isReplacement, replacesCardId, providerSyncNeeded, requestedAt, paidAt, issuedAt, blockedAt, activatedAt`, relations `coop`, `shareholder`, `replacesCard`, `replacedBy`, `payments`.
  - `Coop.chargeCardsEnabled`, `Coop.chargeCardFee`, `Coop.chargeCardReplacementFee`, `Coop.chargeCardVatRate`, `Coop.chargeCards`; `Shareholder.chargeCards`.
  - `Payment.registrationId String?`, `Payment.chargeCardId String?`, `Payment.chargeCard ChargeCard?`; DB CHECK `payments_exactly_one_target_check`.
  - `createTestChargeCard(prisma, coopId, shareholderId, data?)` and `createTestCoop(prisma, data?: { chargeCardsEnabled?: boolean })` in `test-db.ts`.

- [ ] **Step 1: Write the failing digest test**

Create `apps/api/src/modules/admin-notifications/admin-notifications.service.spec.ts`:

```ts
import { AdminNotificationsService } from './admin-notifications.service';

describe('AdminNotificationsService digests', () => {
  it('reports charge-card payments and does not crash on a payment without a registration', async () => {
    const prisma = {
      coopAdmin: {
        findMany: jest.fn().mockResolvedValue([
          {
            coopId: 'coop-1',
            user: { email: 'admin@coop.be', name: 'Admin' },
            coop: { id: 'coop-1', name: 'Coop' },
            notificationSettings: {
              notifyOnNewShareholder: false,
              notifyOnSharePurchase: false,
              notifyOnShareSell: false,
              notifyOnPaymentReceived: true,
            },
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: 100,
            registration: { shareholder: { firstName: 'Jan', lastName: 'Peeters', companyName: null } },
            chargeCard: null,
          },
          {
            amount: 6,
            registration: null,
            chargeCard: { shareholder: { firstName: null, lastName: null, companyName: 'Bakkerij Janssens' } },
          },
        ]),
      },
    };
    const email = { sendAdminDigest: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminNotificationsService(prisma as any, email as any);

    await (service as any).sendDigests('DAILY', new Date(0), 8);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ chargeCard: expect.anything() }) }),
    );
    expect(email.sendAdminDigest).toHaveBeenCalledWith(
      'coop-1',
      'admin@coop.be',
      expect.objectContaining({
        events: [
          { event: 'payment_received', data: { shareholderName: 'Jan Peeters', paymentAmount: 100 } },
          { event: 'payment_received', data: { shareholderName: 'Bakkerij Janssens', paymentAmount: 6 } },
        ],
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @opencoop/api exec jest src/modules/admin-notifications`
Expected: FAIL with `TypeError: Cannot read properties of null (reading 'shareholder')`. This is the crash the spec predicts: one card payment kills the whole digest.

- [ ] **Step 3: Change the schema**

In `packages/database/prisma/schema.prisma`:

1. After the `AdminNotificationFrequency` enum block, add:

```prisma
enum ChargeCardStatus {
  REQUESTED
  PAID
  ACTIVE
  BLOCKED
  CANCELLED
}

enum ChargeCardBlockReason {
  NO_SHARES
  LOST
  ADMIN
}
```

2. In model `Coop`, after the line `apiKeyPrefix             String?` (end of the Ecopower block), add:

```prisma

  // Charge cards (laadpassen). Fees are incl. VAT; the VAT rate is stored for later invoicing.
  chargeCardsEnabled       Boolean @default(false)
  chargeCardFee            Decimal @default(6.00) @db.Decimal(12, 2)
  chargeCardReplacementFee Decimal @default(12.00) @db.Decimal(12, 2)
  chargeCardVatRate        Decimal @default(21) @db.Decimal(5, 2)
```

3. In model `Coop`, in the Relations list, after `meetings         Meeting[]`, add `  chargeCards      ChargeCard[]`.
4. In model `Shareholder`, in the Relations list, after `votes                    Vote[]`, add `  chargeCards              ChargeCard[]`.
5. Replace the whole `model Payment { ... }` block with:

```prisma
model Payment {
  id             String   @id @default(cuid())
  // Exactly one of registrationId / chargeCardId is set (DB CHECK payments_exactly_one_target_check).
  registrationId String?
  chargeCardId   String?
  coopId         String
  amount         Decimal  @db.Decimal(12, 2) // always positive
  bankDate       DateTime // when the bank transaction cleared
  createdAt      DateTime @default(now())

  // Link to imported bank statement
  bankTransactionId String? @unique

  // Who matched it
  matchedByUserId String?
  matchedAt       DateTime?

  // Relations
  registration    Registration?    @relation(fields: [registrationId], references: [id], onDelete: Cascade)
  chargeCard      ChargeCard?      @relation(fields: [chargeCardId], references: [id], onDelete: Cascade)
  coop            Coop             @relation(fields: [coopId], references: [id], onDelete: Cascade)
  bankTransaction BankTransaction? @relation(fields: [bankTransactionId], references: [id], onDelete: SetNull)
  matchedBy       User?            @relation("PaymentMatcher", fields: [matchedByUserId], references: [id], onDelete: SetNull)

  @@index([registrationId])
  @@index([chargeCardId])
  @@index([bankDate])
  @@map("payments")
}

model ChargeCard {
  id                 String                 @id @default(cuid())
  coopId             String
  shareholderId      String
  label              String?
  status             ChargeCardStatus       @default(REQUESTED)
  blockReason        ChargeCardBlockReason?
  ogmCode            String                 @unique
  cardNumber         String? // printed number or RFID UID, set on issue
  feeInclVat         Decimal                @db.Decimal(12, 2) // frozen at request time
  isReplacement      Boolean                @default(false)
  replacesCardId     String?                @unique // a LOST card is replaced at most once
  providerSyncNeeded Boolean                @default(false) // v1: admin must mirror a block/unblock in the provider portal
  requestedAt        DateTime               @default(now())
  paidAt             DateTime?
  issuedAt           DateTime?
  blockedAt          DateTime?
  activatedAt        DateTime? // set on issue, re-enable request and every unblock

  coop         Coop        @relation(fields: [coopId], references: [id], onDelete: Cascade)
  shareholder  Shareholder @relation(fields: [shareholderId], references: [id], onDelete: Cascade)
  replacesCard ChargeCard? @relation("ChargeCardReplacement", fields: [replacesCardId], references: [id], onDelete: SetNull)
  replacedBy   ChargeCard? @relation("ChargeCardReplacement")
  payments     Payment[]

  @@unique([coopId, cardNumber])
  @@index([shareholderId])
  @@index([coopId, status])
  @@map("charge_cards")
}
```

Run: `pnpm db:generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 4: Write the migration**

Create `packages/database/prisma/migrations/20261005110000_charge_cards/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ChargeCardStatus" AS ENUM ('REQUESTED', 'PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeCardBlockReason" AS ENUM ('NO_SHARES', 'LOST', 'ADMIN');

-- AlterTable
ALTER TABLE "coops" ADD COLUMN     "chargeCardFee" DECIMAL(12,2) NOT NULL DEFAULT 6.00,
ADD COLUMN     "chargeCardReplacementFee" DECIMAL(12,2) NOT NULL DEFAULT 12.00,
ADD COLUMN     "chargeCardVatRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
ADD COLUMN     "chargeCardsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "chargeCardId" TEXT,
ALTER COLUMN "registrationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "charge_cards" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "label" TEXT,
    "status" "ChargeCardStatus" NOT NULL DEFAULT 'REQUESTED',
    "blockReason" "ChargeCardBlockReason",
    "ogmCode" TEXT NOT NULL,
    "cardNumber" TEXT,
    "feeInclVat" DECIMAL(12,2) NOT NULL,
    "isReplacement" BOOLEAN NOT NULL DEFAULT false,
    "replacesCardId" TEXT,
    "providerSyncNeeded" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "charge_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_ogmCode_key" ON "charge_cards"("ogmCode");

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_replacesCardId_key" ON "charge_cards"("replacesCardId");

-- CreateIndex
CREATE INDEX "charge_cards_shareholderId_idx" ON "charge_cards"("shareholderId");

-- CreateIndex
CREATE INDEX "charge_cards_coopId_status_idx" ON "charge_cards"("coopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_coopId_cardNumber_key" ON "charge_cards"("coopId", "cardNumber");

-- CreateIndex
CREATE INDEX "payments_chargeCardId_idx" ON "payments"("chargeCardId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_chargeCardId_fkey" FOREIGN KEY ("chargeCardId") REFERENCES "charge_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_replacesCardId_fkey" FOREIGN KEY ("replacesCardId") REFERENCES "charge_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A payment belongs to exactly one target. Prisma cannot express this; it
-- lives only in this migration (db push in CI e2e does not create it).
ALTER TABLE "payments" ADD CONSTRAINT "payments_exactly_one_target_check"
  CHECK (num_nonnulls("registrationId", "chargeCardId") = 1);
```

- [ ] **Step 5: Prove the migration matches the schema**

Run from `packages/database` the same `prisma migrate diff ... --exit-code; echo "exit=$?"` command as Task 1 Step 11.
Expected: the `--script` output equals the baseline (`tasks/charge-cards-baseline-drift.sql`), as in Task 1 Step 11. Prisma does not model CHECK constraints, so the extra constraint never shows up as drift. Any extra statement is what Prisma still wants (usually a column order or a default literal like `21` vs `21.00`); align `migration.sql`.

- [ ] **Step 6: Fix the digest reader**

In `apps/api/src/modules/admin-notifications/admin-notifications.service.ts`, replace:

```ts
        const payments = await this.prisma.payment.findMany({
          where: { coopId: admin.coopId, createdAt: { gte: since } },
          include: {
            registration: {
              include: { shareholder: { select: { firstName: true, lastName: true, companyName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const payment of payments) {
          const sh = payment.registration.shareholder;
```

with:

```ts
        const nameSelect = { select: { firstName: true, lastName: true, companyName: true } };
        const payments = await this.prisma.payment.findMany({
          where: { coopId: admin.coopId, createdAt: { gte: since } },
          include: {
            registration: { include: { shareholder: nameSelect } },
            chargeCard: { include: { shareholder: nameSelect } },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const payment of payments) {
          // A payment belongs to a registration or to a charge card.
          const sh = payment.registration?.shareholder ?? payment.chargeCard?.shareholder;
          if (!sh) continue;
```

The rest of the loop body stays as it is.

- [ ] **Step 7: Run the digest test and watch it pass**

Run: `pnpm --filter @opencoop/api exec jest src/modules/admin-notifications`
Expected: PASS, 1 test.

- [ ] **Step 8: Show the card on matched bank transactions**

Append to `apps/api/src/modules/bank-import/bank-import.service.spec.ts`, before the final `});`:

```ts
  it('loads the charge card owner of a matched payment for the transaction list', async () => {
    prisma.bankTransaction.findMany = jest.fn().mockResolvedValue([]);

    await service.getTransactions(COOP_ID);

    const include = prisma.bankTransaction.findMany.mock.calls[0][0].include;
    expect(include.matchedPayment.include.chargeCard).toEqual({
      select: {
        label: true,
        shareholder: { select: { firstName: true, lastName: true, companyName: true } },
      },
    });
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import`
Expected: FAIL — `include.matchedPayment.include.chargeCard` is `undefined`.

In `apps/api/src/modules/bank-import/bank-import.service.ts`, `getTransactions`, replace the `include` with:

```ts
      include: {
        matchedPayment: {
          include: {
            registration: {
              include: {
                shareholder: {
                  select: { firstName: true, lastName: true, companyName: true },
                },
              },
            },
            chargeCard: {
              select: {
                label: true,
                shareholder: { select: { firstName: true, lastName: true, companyName: true } },
              },
            },
          },
        },
      },
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import`
Expected: PASS.

In `apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx`, replace the interfaces `MatchedRegistration` and `MatchedPayment` with:

```ts
interface MatchedRegistration {
  shareholder?: MatchedShareholder;
}

interface MatchedChargeCard {
  label: string | null;
  shareholder?: MatchedShareholder;
}

interface MatchedPayment {
  registration?: MatchedRegistration | null;
  chargeCard?: MatchedChargeCard | null;
}
```

and replace `const shareholder = tx.matchedPayment?.registration?.shareholder;` with:

```ts
                  const shareholder =
                    tx.matchedPayment?.registration?.shareholder ?? tx.matchedPayment?.chargeCard?.shareholder;
```

- [ ] **Step 9: Check the remaining readers**

`grep` found these readers of `payments` besides the ones fixed above. Each one is safe with a nullable `registrationId`; do not change them:

- `apps/api/src/modules/system/system.controller.ts:108-116` filters `registration: { type: 'BUY', ... }`. A card payment has no registration, so the filter drops it, and card fees stay out of "total capital". The type check in Step 11 proves it still compiles.
- `apps/api/src/modules/payments/payments.service.ts:17-22` (`findByRegistration`) filters on `registrationId`; it never returns card payments. Task 3 deletes the unused `findByOgmCode` next to it.
- Raw SQL in `admin/reports.service.ts`, `admin/analytics.service.ts`, `admin/admin.controller.ts:369`, `mcp/tools/mcp-coop.tools.ts:110` all `JOIN registrations r ON r.id = p."registrationId"` (inner join), so card payments never count as capital.
- `registrations.service.ts:648` (`updatePaymentDate`) filters on `registrationId`.
- `bank-matching.service.ts` (`matchTransaction`) reads the unlinked payments of one registration (`registrationId: registration.id`).

One reader is new on main and is not safe: `PaymentsService.findUnlinkedByCoopId` (the "link to an existing payment" list in the bank-import match dialog, `GET .../payments/unlinked`) returns every coop payment without a bank transaction, and `bank-import/page.tsx:558-561` reads `payment.registration.shareholder` without a guard. A card payment always gets its bank transaction in v1, but one without it would crash the dialog. Limit the list to registration payments, which is all the dialog can link.

Append to `apps/api/src/modules/payments/payments.service.spec.ts`, inside the `describe`:

```ts
  it('lists only registration payments as unlinked (the link dialog reads payment.registration)', async () => {
    prisma.payment.findMany = jest.fn().mockResolvedValue([]);

    await service.findUnlinkedByCoopId('coop-A');

    expect(prisma.payment.findMany.mock.calls[0][0].where).toEqual({
      coopId: 'coop-A',
      bankTransactionId: null,
      registrationId: { not: null },
    });
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/payments`
Expected: FAIL — the `where` has no `registrationId`.

In `apps/api/src/modules/payments/payments.service.ts`, `findUnlinkedByCoopId`, change `bankTransactionId: null,` to:

```ts
        bankTransactionId: null,
        // Charge-card payments are never offered for linking; the dialog reads payment.registration.
        registrationId: { not: null },
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/payments`
Expected: PASS.

Confirm the grep finds nothing new:

Run: `grep -rn "payment\.registration\b\|payments\.registration\b\|\.registration\.shareholder" apps/api/src apps/web/src --include='*.ts' --include='*.tsx' | grep -v '\.d\.ts'`
Expected: the two lines you changed (with `?.`) and the three `payment.registration` lines in `bank-import/page.tsx:558-561`, which the filter above keeps safe.

- [ ] **Step 10: Write the CHECK-constraint DB spec**

In `apps/api/src/test-utils/test-db.ts`, replace `createTestCoop` (the coop now has charge-card fields) with:

```ts
export async function createTestCoop(prisma: PrismaClient, data: { chargeCardsEnabled?: boolean } = {}) {
  counter += 1;
  const taken = new Set((await prisma.coop.findMany({ select: { ogmPrefix: true } })).map((c) => c.ogmPrefix));
  let prefix = 900;
  while (taken.has(String(prefix))) prefix += 1;
  return prisma.coop.create({
    data: { slug: `${SLUG_PREFIX}${Date.now()}-${counter}`, name: 'DB test coop', ogmPrefix: String(prefix), ...data },
  });
}
```

and add:

```ts
export async function createTestChargeCard(
  prisma: PrismaClient,
  coopId: string,
  shareholderId: string,
  data: Partial<{
    status: 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
    blockReason: 'NO_SHARES' | 'LOST' | 'ADMIN' | null;
    providerSyncNeeded: boolean;
    feeInclVat: number;
  }> = {},
) {
  counter += 1;
  return prisma.chargeCard.create({
    data: {
      coopId,
      shareholderId,
      ogmCode: `${SLUG_PREFIX}ogm-${Date.now()}-${counter}`,
      feeInclVat: 6,
      ...data,
    },
  });
}
```

Create `apps/api/src/modules/payments/payments.db.spec.ts`:

```ts
import { PrismaClient } from '@opencoop/database';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareClass,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('payments_exactly_one_target_check (database)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('rejects a payment that belongs to nothing', async () => {
    const coop = await createTestCoop(prisma);

    await expect(
      prisma.payment.create({ data: { coopId: coop.id, amount: 6, bankDate: new Date() } }),
    ).rejects.toThrow(/payments_exactly_one_target_check/);
  });

  it('rejects a payment that belongs to a registration and a charge card', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    const registration = await prisma.registration.create({
      data: {
        coopId: coop.id, shareholderId: shareholder.id, shareClassId: shareClass.id, type: 'BUY',
        quantity: 1, pricePerShare: 10, totalAmount: 10, registerDate: new Date(),
      },
    });
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id);

    await expect(
      prisma.payment.create({
        data: { coopId: coop.id, registrationId: registration.id, chargeCardId: card.id, amount: 6, bankDate: new Date() },
      }),
    ).rejects.toThrow(/payments_exactly_one_target_check/);
  });

  it('accepts a payment that belongs to a charge card only', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id);

    const payment = await prisma.payment.create({
      data: { coopId: coop.id, chargeCardId: card.id, amount: 6, bankDate: new Date() },
    });

    expect(payment.registrationId).toBeNull();
    expect(payment.chargeCardId).toBe(card.id);
  });
});
```

Run:

```bash
docker compose -f docker-compose.test.yml up -d --force-recreate --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma db push --skip-generate --accept-data-loss
TEST_DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/api exec jest --runInBand db.spec
```

Expected: `migrate deploy` applies both new migrations; `ogm.db.spec` and `payments.db.spec` PASS, 5 tests.

- [ ] **Step 11: Build, test, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/web build
```

Expected: both builds exit 0; all unit suites pass.

```bash
git add packages/database/prisma/schema.prisma \
  packages/database/prisma/migrations/20261005110000_charge_cards/migration.sql \
  apps/api/src/modules/admin-notifications/admin-notifications.service.ts \
  apps/api/src/modules/admin-notifications/admin-notifications.service.spec.ts \
  apps/api/src/modules/bank-import/bank-import.service.ts \
  apps/api/src/modules/bank-import/bank-import.service.spec.ts \
  apps/api/src/modules/payments/payments.db.spec.ts apps/api/src/test-utils/test-db.ts \
  apps/api/src/modules/payments/payments.service.ts apps/api/src/modules/payments/payments.service.spec.ts \
  "apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx"
git commit -m "feat(payments): a payment belongs to a registration or a charge card"
```

---
### Task 3: One OGM resolver (registrations)

Main moved ahead of this plan (v2026.39.1 to v2026.39.4): `extractOgmCode` in `@opencoop/shared` normalises every OGM shape, `BankMatchingService.matchTransaction` is the one matcher behind CSV import, Ponto and rematch, Ponto stores and matches the formatted OGM, and `manualMatch` is scoped to the coop. This task puts the remaining registration-only lookups (the matcher's single lookup and the CSV batch lookup) behind `OgmService`, so Task 5 adds charge cards in one place. Behaviour does not change.

**Files:**
- Create: `apps/api/src/modules/ogm/payment-target.ts`
- Modify: `apps/api/src/modules/ogm/ogm.service.ts`, `apps/api/src/modules/ogm/ogm.service.spec.ts`
- Modify: `apps/api/src/modules/bank-import/bank-matching.service.ts` (imports, `BankMatchingRegistration`, constructor, `matchTransaction`), `apps/api/src/modules/bank-import/bank-matching.service.spec.ts`
- Modify: `apps/api/src/modules/bank-import/bank-import.service.ts:1-16` (imports, constructor), `:180-198` (batched registration lookup), `:237` (matcher call)
- Modify: `apps/api/src/modules/bank-import/bank-import.module.ts`, `apps/api/src/modules/bank-import/bank-import.service.spec.ts`, `apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts` (providers)
- Modify: `apps/api/src/modules/payments/payments.service.ts:24-39` (delete the unused `findByOgmCode`)

**Interfaces:**
- Consumes: `OgmService` (Task 1); `extractOgmCode` from `@opencoop/shared` (on main).
- Produces:
  - `RegistrationTarget = { kind: 'registration'; id: string; coopId: string; status: string; totalAmount?: unknown; ogmCode?: string | null; payments?: Array<{ id: string; amount: unknown; bankDate: Date; bankTransactionId: string | null }> }`: the shape `BankMatchingService` already used (`BankMatchingRegistration`), plus `kind`.
  - `PaymentTarget = RegistrationTarget` (Task 5 widens it).
  - `OgmService.resolveOgmTargets(coopId: string, ogms: Array<string | null | undefined>): Promise<Map<string, PaymentTarget>>`: one query per target table; keys are the formatted codes.
  - `OgmService.resolveOgmTarget(coopId: string, ogm: string | null | undefined): Promise<PaymentTarget | null>`.
  - `BankMatchingService.matchTransaction(coopId, transaction, matchedByUserId?, allowCreate = true, targetOverride?: PaymentTarget)` (the fifth parameter was `registrationOverride?: BankMatchingRegistration`).

- [ ] **Step 1: Write the failing resolver tests**

Append to `apps/api/src/modules/ogm/ogm.service.spec.ts` (add `import { Prisma } from '@opencoop/database';` to the imports):

```ts
describe('OgmService resolvers', () => {
  const OGM = '+++090/9337/55493+++';
  const registrationRow = {
    id: 'reg-1',
    coopId: 'coop-1',
    status: 'PENDING_PAYMENT',
    totalAmount: new Prisma.Decimal('250.00'),
    ogmCode: OGM,
    payments: [],
  };
  let prisma: any;
  let service: OgmService;

  beforeEach(() => {
    prisma = {
      registration: {
        findMany: jest.fn().mockResolvedValue([registrationRow]),
        findFirst: jest.fn().mockResolvedValue(registrationRow),
      },
    };
    service = new OgmService(prisma);
  });

  it('normalises digit-only and formatted OGMs into one coop-scoped query', async () => {
    const targets = await service.resolveOgmTargets('coop-1', ['090933755493', OGM, 'not an ogm', null]);

    expect(prisma.registration.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.registration.findMany.mock.calls[0][0].where).toEqual({
      coopId: 'coop-1',
      ogmCode: { in: [OGM] },
    });
    expect(targets.get(OGM)).toEqual({ kind: 'registration', ...registrationRow });
  });

  it('does not query when no input is a valid OGM', async () => {
    const targets = await service.resolveOgmTargets('coop-1', ['hello', null, undefined]);

    expect(targets.size).toBe(0);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it('resolveOgmTarget normalises the OGM and looks it up within the coop', async () => {
    await expect(service.resolveOgmTarget('coop-1', '090933755493')).resolves.toMatchObject({
      kind: 'registration',
      id: 'reg-1',
    });

    expect(prisma.registration.findFirst.mock.calls[0][0].where).toEqual({ coopId: 'coop-1', ogmCode: OGM });
  });

  it('resolveOgmTarget returns null for an invalid OGM without querying', async () => {
    await expect(service.resolveOgmTarget('coop-1', '123')).resolves.toBeNull();
    expect(prisma.registration.findFirst).not.toHaveBeenCalled();
  });

  it('resolveOgmTarget returns null when no registration has the OGM', async () => {
    prisma.registration.findFirst.mockResolvedValue(null);

    await expect(service.resolveOgmTarget('coop-1', OGM)).resolves.toBeNull();
  });
});
```

`090933755493` is a valid OGM (`extractOgmCode('090933755493')` returns `+++090/9337/55493+++`; checked in preflight).

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/ogm.service.spec`
Expected: FAIL — `service.resolveOgmTargets is not a function`.

- [ ] **Step 2: Implement the target type and the resolvers**

Create `apps/api/src/modules/ogm/payment-target.ts`:

```ts
/**
 * Something a bank payment can be booked on, in the shape BankMatchingService
 * works with. Task 5 adds charge cards.
 */
export interface RegistrationTarget {
  kind: 'registration';
  id: string;
  coopId: string;
  status: string;
  totalAmount?: unknown;
  ogmCode?: string | null;
  payments?: { id: string; amount: unknown; bankDate: Date; bankTransactionId: string | null }[];
}

export type PaymentTarget = RegistrationTarget;
```

In `apps/api/src/modules/ogm/ogm.service.ts`:

1. Change the shared import to `import { extractOgmCode, generateOgmCode } from '@opencoop/shared';` and add `import { PaymentTarget, RegistrationTarget } from './payment-target';`.
2. Add above `@Injectable()`:

```ts
const REGISTRATION_TARGET_SELECT = {
  id: true,
  coopId: true,
  status: true,
  totalAmount: true,
  ogmCode: true,
  payments: { select: { id: true, amount: true, bankDate: true, bankTransactionId: true } },
} satisfies Prisma.RegistrationSelect;

type RegistrationTargetRow = Prisma.RegistrationGetPayload<{ select: typeof REGISTRATION_TARGET_SELECT }>;

function toRegistrationTarget(row: RegistrationTargetRow): RegistrationTarget {
  return { kind: 'registration', ...row };
}
```

3. Add these methods after `nextOgmCode`:

```ts
  /**
   * Resolves many OGMs in one query per target table (the CSV import batch).
   * Inputs may be formatted or digit-only; invalid ones are dropped. Keys are
   * the formatted codes, as stored.
   */
  async resolveOgmTargets(
    coopId: string,
    ogms: Array<string | null | undefined>,
  ): Promise<Map<string, PaymentTarget>> {
    const codes = [
      ...new Set(ogms.map((ogm) => extractOgmCode(ogm)).filter((ogm): ogm is string => ogm !== null)),
    ];
    const targets = new Map<string, PaymentTarget>();
    if (codes.length === 0) return targets;

    const registrations = await this.prisma.registration.findMany({
      where: { coopId, ogmCode: { in: codes } },
      select: REGISTRATION_TARGET_SELECT,
    });
    for (const row of registrations) {
      if (row.ogmCode) targets.set(row.ogmCode, toRegistrationTarget(row));
    }
    return targets;
  }

  /** Resolves one OGM (Ponto, rematch), with the same normalisation. */
  async resolveOgmTarget(coopId: string, ogm: string | null | undefined): Promise<PaymentTarget | null> {
    const ogmCode = extractOgmCode(ogm);
    if (!ogmCode) return null;
    const registration = await this.prisma.registration.findFirst({
      where: { coopId, ogmCode },
      select: REGISTRATION_TARGET_SELECT,
    });
    return registration ? toRegistrationTarget(registration) : null;
  }
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm`
Expected: PASS, all OGM specs.

- [ ] **Step 3: Write the failing matcher and CSV tests**

In `apps/api/src/modules/bank-import/bank-matching.service.spec.ts`:

1. Add `import { OgmService } from '../ogm/ogm.service';`.
2. Below `let paymentsService: any;` add `let ogmService: OgmService;`.
3. In the `providers` array, add `OgmService,` after `BankMatchingService,` (the real service, on top of the prisma mock).
4. Below `service = moduleRef.get(BankMatchingService);` add `ogmService = moduleRef.get(OgmService);`.
5. Append before the final `});`:

```ts
  it('looks the OGM up through OgmService, within the coop', async () => {
    const resolve = jest.spyOn(ogmService, 'resolveOgmTarget');
    prisma.registration.findFirst.mockResolvedValue(null);

    const result = await service.matchTransaction('coop-1', bankTransaction);

    expect(result.status).toBe('UNMATCHED');
    expect(resolve).toHaveBeenCalledWith('coop-1', OGM);
  });
```

In `apps/api/src/modules/bank-import/bank-import.service.spec.ts`:

1. Add `import { OgmService } from '../ogm/ogm.service';`.
2. Below `let bankMatchingService: any;` add `let ogmService: OgmService;`.
3. In the `providers` array, add `OgmService,` after `BankImportService,`.
4. Below `service = moduleRef.get(BankImportService);` add `ogmService = moduleRef.get(OgmService);`.
5. Append before the final `});`:

```ts
  it('resolves every OGM of the file in one OgmService call, scoped to the coop', async () => {
    const resolve = jest.spyOn(ogmService, 'resolveOgmTargets');

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csvRows([
        ['2026-01-15', '100', 'A', OGM],
        ['2026-01-16', '50', 'B', `ref ${OGM}`],
        ['2026-01-17', '-20', 'C', OGM],
      ]),
      'generic',
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(COOP_ID, [OGM]);
  });
```

In `apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts`, add `import { OgmService } from '../ogm/ogm.service';` and add `OgmService,` to the `providers` array after `BankMatchingService,`.

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import`
Expected: FAIL in exactly the two new tests: `resolveOgmTarget` and `resolveOgmTargets` were never called, because the matcher and the CSV import still query `prisma.registration` themselves.

- [ ] **Step 4: Route the matcher through the resolver**

In `apps/api/src/modules/bank-import/bank-matching.service.ts`:

1. Add `import { OgmService } from '../ogm/ogm.service';` and `import { PaymentTarget } from '../ogm/payment-target';`.
2. Delete the `export interface BankMatchingRegistration { ... }` block. `matchTransaction` was its only user (`grep -rn BankMatchingRegistration apps/api/src` finds nothing else).
3. Add `private readonly ogm: OgmService,` as the last constructor parameter.
4. In `matchTransaction`, change the last parameter `registrationOverride?: BankMatchingRegistration,` to `targetOverride?: PaymentTarget,`.
5. Replace:

```ts
    const registration = registrationOverride || await this.prisma.registration.findFirst({
      where: { coopId, ogmCode },
      select: {
        id: true,
        coopId: true,
        status: true,
        totalAmount: true,
        payments: {
          select: { id: true, amount: true, bankDate: true, bankTransactionId: true },
        },
      },
    });
    if (!registration) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }
```

with:

```ts
    // One resolver for every OGM. The CSV import passes the target it batch-loaded
    // (targetOverride) and reuses that object for later rows of the same file, so the
    // updates to `cached` below keep it current. A freshly resolved target is not cached.
    const target = targetOverride ?? (await this.ogm.resolveOgmTarget(coopId, ogmCode));
    if (!target) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }
    const registration = target;
    const cached = targetOverride ? registration : undefined;
```

6. Rename every remaining `registrationOverride` in the file to `cached`:

```bash
sed -i '' 's/registrationOverride/cached/g' apps/api/src/modules/bank-import/bank-matching.service.ts
grep -c registrationOverride apps/api/src/modules/bank-import/bank-matching.service.ts
```

Expected: `0`. The renamed lines keep their exact behaviour: they only ran when the caller passed an override, and `cached` is set only then.

- [ ] **Step 5: Route the CSV batch through the resolver**

In `apps/api/src/modules/bank-import/bank-import.service.ts`:

1. Add `import { OgmService } from '../ogm/ogm.service';`.
2. Add `private ogm: OgmService,` as the last constructor parameter (after `private bankMatchingService: BankMatchingService,`).
3. Replace the block from `const registrationMap = new Map<string, any>();` down to and including the closing `}` of its `if (uniqueOgms.length > 0) { ... }` with:

```ts
    // One batched lookup for every OGM in the file (no per-row N+1).
    const targets = await this.ogm.resolveOgmTargets(coopId, uniqueOgms);
```

4. In the `matchTransaction` call inside the row loop, change `ogmCode ? registrationMap.get(ogmCode) : undefined` to `ogmCode ? targets.get(ogmCode) : undefined`.

In `apps/api/src/modules/bank-import/bank-import.module.ts`, add `import { OgmModule } from '../ogm/ogm.module';` and change `imports` to `[RegistrationsModule, ShareholderStatusModule, PaymentsModule, OgmModule]`. `PontoModule` imports `BankImportModule`, so Ponto gets the resolver through `BankMatchingService` with no change of its own.

In `apps/api/src/modules/payments/payments.service.ts`, delete the method `findByOgmCode` (lines 24-39). It has no callers (`grep -rn findByOgmCode apps/api/src` finds only the definition) and was one more registration-only OGM lookup.

- [ ] **Step 6: Run every touched suite and watch it pass**

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm src/modules/bank-import src/modules/ponto src/modules/payments src/modules/mcp`
Expected: PASS, including the two new tests; no existing test changed.

- [ ] **Step 7: Build, full test run, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/api lint
```

Expected: build exits 0; all suites pass; lint reports 0 errors.

```bash
git add apps/api/src/modules/ogm/payment-target.ts apps/api/src/modules/ogm/ogm.service.ts \
  apps/api/src/modules/ogm/ogm.service.spec.ts \
  apps/api/src/modules/bank-import/bank-matching.service.ts \
  apps/api/src/modules/bank-import/bank-matching.service.spec.ts \
  apps/api/src/modules/bank-import/bank-import.service.ts apps/api/src/modules/bank-import/bank-import.module.ts \
  apps/api/src/modules/bank-import/bank-import.service.spec.ts \
  apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts \
  apps/api/src/modules/payments/payments.service.ts
git commit -m "refactor(bank-import): resolve OGMs through one OgmService lookup"
```

---

### Task 4: Charge-card API for shareholders

**Files:**
- Create: `apps/api/src/modules/shareholders/shareholder-access.ts`, `apps/api/src/modules/shareholders/shareholder-access.spec.ts`
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts:150-167` (`verifyShareholder`)
- Create: `apps/api/src/modules/charge-cards/charge-card-view.ts`
- Create: `apps/api/src/modules/charge-cards/charge-card-transition.ts`
- Create: `apps/api/src/modules/charge-cards/dto/request-charge-card.dto.ts`
- Create: `apps/api/src/modules/charge-cards/charge-cards.service.ts`, `apps/api/src/modules/charge-cards/charge-cards.service.spec.ts`
- Create: `apps/api/src/modules/charge-cards/charge-cards.controller.ts`
- Create: `apps/api/src/modules/charge-cards/charge-cards.module.ts`
- Modify: `apps/api/src/app.module.ts` (register the module)
- Modify: `apps/api/src/modules/email/email.service.ts` (add `sendChargeCardCoopNotice`)
- Create: `apps/api/src/modules/email/email.service.charge-cards.spec.ts`
- Modify: `apps/api/src/modules/email/email.processor.ts` (template `charge-card-coop-notice` in `renderTemplate`)
- Modify: `apps/api/src/modules/email/i18n/{nl,en,fr,de}.json`
- Modify: `apps/api/src/modules/email/email.processor.render.spec.ts` (sample data)
- Modify: `apps/api/src/modules/coops/dto/update-coop.dto.ts`, `apps/api/src/modules/coops/coops.service.ts:358-400` (`getSettings` select)
- Create: `apps/api/src/modules/coops/dto/update-coop.dto.spec.ts`

**Interfaces:**
- Consumes: `OgmService.nextOgmCode` (Task 1); `ChargeCard` model and coop fields (Task 2).
- Produces:
  - `canActForShareholder(shareholder: { userId: string | null; type: string; registeredByUserId: string | null }, userId: string): boolean`.
  - `shareholderDisplayName(sh)`, `ChargeCardView`, `toChargeCardView(card)` in `charge-card-view.ts`.
  - `transitionCard(db, scope, allowed, data, refusal): Promise<ChargeCard>` and `CAN_REPORT_LOST: Prisma.ChargeCardWhereInput` in `charge-card-transition.ts`.
  - `ChargeCardsService`: `listForShareholder(shareholderId, userId)`, `request(shareholderId, userId, dto)`, `cancel(shareholderId, userId, cardId)`, `reportLost(shareholderId, userId, cardId)`, `requestReenable(shareholderId, userId, cardId)`.
  - HTTP (JWT): `GET /shareholders/:shareholderId/charge-cards`, `POST /shareholders/:shareholderId/charge-cards` `{ label?, replacesCardId? }`, `POST .../:cardId/cancel`, `POST .../:cardId/report-lost`, `POST .../:cardId/request-reenable`.
  - `EmailService.sendChargeCardCoopNotice(coopId, to, data: { kind: 'requested' | 'reenable'; shareholderName; label: string | null; ogmCode; amount: number; isReplacement: boolean })`, template key `charge-card-coop-notice`.
  - `ChargeCardsModule` (Task 6 adds the admin controller to it).
  - Settings API accepts and returns `chargeCardsEnabled`, `chargeCardFee`, `chargeCardReplacementFee`, `chargeCardVatRate`.

- [ ] **Step 1: Write the failing access-rule test**

Create `apps/api/src/modules/shareholders/shareholder-access.spec.ts`:

```ts
import { canActForShareholder } from './shareholder-access';

describe('canActForShareholder', () => {
  it('allows the linked user', () => {
    expect(canActForShareholder({ userId: 'u1', type: 'INDIVIDUAL', registeredByUserId: null }, 'u1')).toBe(true);
  });

  it('allows the parent who registered a minor', () => {
    expect(canActForShareholder({ userId: null, type: 'MINOR', registeredByUserId: 'u2' }, 'u2')).toBe(true);
  });

  it('refuses the registering user of a shareholder who is not a minor', () => {
    expect(canActForShareholder({ userId: null, type: 'COMPANY', registeredByUserId: 'u2' }, 'u2')).toBe(false);
  });

  it('refuses anyone else', () => {
    expect(canActForShareholder({ userId: 'u1', type: 'INDIVIDUAL', registeredByUserId: null }, 'u3')).toBe(false);
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/shareholders/shareholder-access`
Expected: FAIL — `Cannot find module './shareholder-access'`.

- [ ] **Step 2: Extract the rule**

Create `apps/api/src/modules/shareholders/shareholder-access.ts`:

```ts
export interface ShareholderOwnership {
  userId: string | null;
  type: string;
  registeredByUserId: string | null;
}

/** A user may act for their own shareholder record, or for a minor they registered. */
export function canActForShareholder(shareholder: ShareholderOwnership, userId: string): boolean {
  if (shareholder.userId === userId) return true;
  return shareholder.type === 'MINOR' && shareholder.registeredByUserId === userId;
}
```

In `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`, add `import { canActForShareholder } from './shareholder-access';` and in `verifyShareholder` replace:

```ts
    const isOwner = shareholder.userId === userId;
    const isParentOfMinor =
      shareholder.type === 'MINOR' && shareholder.registeredByUserId === userId;

    if (!isOwner && !isParentOfMinor) {
```

with:

```ts
    if (!canActForShareholder(shareholder, userId)) {
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/shareholders`
Expected: PASS.

- [ ] **Step 3: Write the failing service tests**

Create `apps/api/src/modules/charge-cards/charge-cards.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { ChargeCardsService } from './charge-cards.service';

const OGM = '+++090/9337/55493+++';

function shareholder(overrides: Record<string, unknown> = {}, coop: Record<string, unknown> = {}) {
  return {
    id: 'sh-1',
    coopId: 'coop-1',
    userId: 'user-1',
    type: 'INDIVIDUAL',
    registeredByUserId: null,
    status: 'ACTIVE',
    firstName: 'Jan',
    lastName: 'Peeters',
    companyName: null,
    coop: {
      id: 'coop-1',
      name: 'Bronsgroen',
      slug: 'bronsgroen',
      chargeCardsEnabled: true,
      chargeCardFee: new Prisma.Decimal('6.00'),
      chargeCardReplacementFee: new Prisma.Decimal('12.00'),
      bankIban: 'BE68539007547034',
      bankBic: 'GKCCBEBB',
      coopEmail: 'info@bronsgroen.be',
      ...coop,
    },
    ...overrides,
  };
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    label: 'Auto Anna',
    status: 'REQUESTED',
    blockReason: null,
    ogmCode: OGM,
    cardNumber: null,
    feeInclVat: new Prisma.Decimal('6.00'),
    isReplacement: false,
    replacesCardId: null,
    providerSyncNeeded: false,
    requestedAt: new Date('2026-10-05T08:00:00Z'),
    paidAt: null,
    issuedAt: null,
    blockedAt: null,
    activatedAt: null,
    replacedBy: null,
    ...overrides,
  };
}

describe('ChargeCardsService (shareholder side)', () => {
  let prisma: any;
  let ogm: { nextOgmCode: jest.Mock };
  let email: { sendChargeCardCoopNotice: jest.Mock };
  let service: ChargeCardsService;

  beforeEach(() => {
    prisma = {
      shareholder: { findUnique: jest.fn().mockResolvedValue(shareholder()) },
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    ogm = { nextOgmCode: jest.fn().mockResolvedValue(OGM) };
    email = { sendChargeCardCoopNotice: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsService(prisma, ogm as any, email as any);
  });

  describe('access', () => {
    it('refuses the shareholder record of another user', async () => {
      await expect(service.listForShareholder('sh-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    });

    it('lets a parent act for a minor they registered', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(
        shareholder({ type: 'MINOR', userId: null, registeredByUserId: 'parent-1' }),
      );

      await expect(service.listForShareholder('sh-1', 'parent-1')).resolves.toMatchObject({ enabled: true });
    });

    it('returns 404 for an unknown shareholder', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(null);

      await expect(service.listForShareholder('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listForShareholder', () => {
    it('returns enabled=false and no cards when the coop has the feature off', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { chargeCardsEnabled: false }));

      const result = await service.listForShareholder('sh-1', 'user-1');

      expect(result).toMatchObject({ enabled: false, cards: [] });
      expect(prisma.chargeCard.findMany).not.toHaveBeenCalled();
    });

    it('returns fees as numbers and the cards, newest first', async () => {
      prisma.chargeCard.findMany.mockResolvedValue([card()]);

      const result = await service.listForShareholder('sh-1', 'user-1');

      expect(result).toMatchObject({
        enabled: true,
        fee: 6,
        replacementFee: 12,
        shareholderStatus: 'ACTIVE',
        coop: { name: 'Bronsgroen', slug: 'bronsgroen', bankIban: 'BE68539007547034', bankBic: 'GKCCBEBB' },
        cards: [{ id: 'card-1', feeInclVat: 6, replaced: false }],
      });
      expect(prisma.chargeCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shareholderId: 'sh-1' }, orderBy: { requestedAt: 'desc' } }),
      );
    });
  });

  describe('request', () => {
    it('refuses when the coop has charge cards off', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { chargeCardsEnabled: false }));

      await expect(service.request('sh-1', 'user-1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.chargeCard.create).not.toHaveBeenCalled();
    });

    it('refuses a shareholder who is not ACTIVE', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({ status: 'INACTIVE' }));

      await expect(service.request('sh-1', 'user-1', {})).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.create).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED card with the next OGM and the coop fee, and emails the coop', async () => {
      prisma.chargeCard.create.mockResolvedValue(card());

      const result = await service.request('sh-1', 'user-1', { label: '  Auto Anna  ' });

      expect(ogm.nextOgmCode).toHaveBeenCalledWith(prisma, 'coop-1');
      expect(prisma.chargeCard.create).toHaveBeenCalledWith({
        data: {
          coopId: 'coop-1',
          shareholderId: 'sh-1',
          label: 'Auto Anna',
          ogmCode: OGM,
          feeInclVat: new Prisma.Decimal('6.00'),
          isReplacement: false,
          replacesCardId: null,
        },
      });
      expect(result.payment).toEqual({
        beneficiaryName: 'Bronsgroen',
        iban: 'BE68539007547034',
        bic: 'GKCCBEBB',
        amount: 6,
        ogmCode: OGM,
      });
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledWith('coop-1', 'info@bronsgroen.be', {
        kind: 'requested',
        shareholderName: 'Jan Peeters',
        label: 'Auto Anna',
        ogmCode: OGM,
        amount: 6,
        isReplacement: false,
      });
    });

    it('stores a blank label as null', async () => {
      prisma.chargeCard.create.mockResolvedValue(card({ label: null }));

      await service.request('sh-1', 'user-1', { label: '   ' });

      expect(prisma.chargeCard.create).toHaveBeenCalledWith({ data: expect.objectContaining({ label: null }) });
    });

    it('charges the replacement fee when replacing an own LOST card', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST' }));
      prisma.chargeCard.create.mockResolvedValue(
        card({ id: 'card-2', feeInclVat: new Prisma.Decimal('12.00'), isReplacement: true, replacesCardId: 'lost-1' }),
      );

      await service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' });

      expect(prisma.chargeCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lost-1', shareholderId: 'sh-1' } }),
      );
      expect(prisma.chargeCard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          feeInclVat: new Prisma.Decimal('12.00'),
          isReplacement: true,
          replacesCardId: 'lost-1',
        }),
      });
    });

    it('refuses to replace a card that is not lost', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'c-2', status: 'ACTIVE' }));

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'c-2' })).rejects.toThrow(BadRequestException);
    });

    it('refuses to replace a lost card twice', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(
        card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST', replacedBy: { id: 'card-2' } }),
      );

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' })).rejects.toThrow(ConflictException);
    });

    it('turns a unique-index race on replacesCardId into 409', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ id: 'lost-1', status: 'BLOCKED', blockReason: 'LOST' }));
      prisma.chargeCard.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.2.0',
          meta: { target: ['replacesCardId'] },
        }),
      );

      await expect(service.request('sh-1', 'user-1', { replacesCardId: 'lost-1' })).rejects.toThrow(ConflictException);
    });

    it('still creates the card when the coop has no email address', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({}, { coopEmail: null }));
      prisma.chargeCard.create.mockResolvedValue(card());

      await expect(service.request('sh-1', 'user-1', {})).resolves.toMatchObject({ card: { id: 'card-1' } });
      expect(email.sendChargeCardCoopNotice).not.toHaveBeenCalled();
    });
  });

  describe('cancel, report lost, re-enable', () => {
    it('cancels a REQUESTED card', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'CANCELLED' }));

      const result = await service.cancel('sh-1', 'user-1', 'card-1');

      expect(prisma.chargeCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'card-1', shareholderId: 'sh-1' } }),
      );
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: 'card-1' }, { status: 'REQUESTED' }] },
        data: { status: 'CANCELLED' },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('refuses to cancel a card that is no longer REQUESTED', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('returns 404 for a card of another shareholder', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(null);

      await expect(service.cancel('sh-1', 'user-1', 'card-9')).rejects.toThrow(NotFoundException);
    });

    it('reports a card lost and flags the provider sync', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'BLOCKED', blockReason: 'LOST' }));

      await service.reportLost('sh-1', 'user-1', 'card-1');

      const call = prisma.chargeCard.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        AND: [{ id: 'card-1' }, { OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }] }],
      });
      expect(call.data).toEqual({
        status: 'BLOCKED',
        blockReason: 'LOST',
        blockedAt: expect.any(Date),
        providerSyncNeeded: true,
      });
    });

    it('flags a re-enable once and emails the coop once', async () => {
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(card({ status: 'ACTIVE' }))
        .mockResolvedValueOnce(card({ status: 'ACTIVE', providerSyncNeeded: true }));
      prisma.chargeCard.update.mockResolvedValue(card({ status: 'ACTIVE', providerSyncNeeded: true }));

      await service.requestReenable('sh-1', 'user-1', 'card-1');
      await service.requestReenable('sh-1', 'user-1', 'card-1');

      expect(prisma.chargeCard.update).toHaveBeenCalledTimes(1);
      expect(prisma.chargeCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { providerSyncNeeded: true, activatedAt: expect.any(Date) },
      });
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledTimes(1);
      expect(email.sendChargeCardCoopNotice).toHaveBeenCalledWith(
        'coop-1',
        'info@bronsgroen.be',
        expect.objectContaining({ kind: 'reenable' }),
      );
    });

    it('refuses a re-enable for a card that is not ACTIVE', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'BLOCKED', blockReason: 'ADMIN' }));

      await expect(service.requestReenable('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses a re-enable when the shareholder is not ACTIVE', async () => {
      prisma.shareholder.findUnique.mockResolvedValue(shareholder({ status: 'INACTIVE' }));
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'ACTIVE' }));

      await expect(service.requestReenable('sh-1', 'user-1', 'card-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.update).not.toHaveBeenCalled();
    });
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards`
Expected: FAIL — `Cannot find module './charge-cards.service'`.

- [ ] **Step 4: Add the email method and its test**

Create `apps/api/src/modules/email/email.service.charge-cards.spec.ts`:

```ts
import { EmailService } from './email.service';

describe('EmailService charge-card emails', () => {
  it('queues the coop notice in the recipient language with a localised subject', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: 'fr' }) },
      emailLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new EmailService(prisma as any, queue as any);

    await service.sendChargeCardCoopNotice('coop-1', 'info@bronsgroen.be', {
      kind: 'requested',
      shareholderName: 'Jan Peeters',
      label: null,
      ogmCode: '+++090/9337/55493+++',
      amount: 6,
      isReplacement: false,
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        subject: 'Nouvelle demande de carte de recharge',
        templateKey: 'charge-card-coop-notice',
        templateData: expect.objectContaining({ language: 'fr', kind: 'requested' }),
      }),
    );
  });
});
```

In `apps/api/src/modules/email/email.service.ts`, add this method before `sendGiftCertificate`:

```ts
  async sendChargeCardCoopNotice(
    coopId: string,
    to: string,
    data: {
      kind: 'requested' | 'reenable';
      shareholderName: string;
      label: string | null;
      ogmCode: string;
      amount: number;
      isReplacement: boolean;
    },
  ) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<'requested' | 'reenable', Record<string, string>> = {
      requested: {
        nl: 'Nieuwe aanvraag laadpas',
        en: 'New charge card request',
        fr: 'Nouvelle demande de carte de recharge',
        de: 'Neuer Antrag auf Ladekarte',
      },
      reenable: {
        nl: 'Laadpas opnieuw activeren',
        en: 'Charge card re-enable request',
        fr: 'Demande de réactivation de carte de recharge',
        de: 'Antrag auf Reaktivierung einer Ladekarte',
      },
    };
    return this.send({
      coopId,
      to,
      subject: subjects[data.kind][language] || subjects[data.kind]['nl'],
      templateKey: 'charge-card-coop-notice',
      templateData: { ...data, language },
    });
  }
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/email/email.service.charge-cards`
Expected: PASS.

- [ ] **Step 5: Add the template, its copy and its snapshots**

In `apps/api/src/modules/email/email.processor.ts`, inside the `templates` object of `renderTemplate`, add after the `'payment-confirmed'` entry:

```ts
      'charge-card-coop-notice': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const s = buildCopy('charge-card-coop-notice', lang, { coopName: escapeHtml(cn), shareholderName: sn });
        const reenable = d.kind === 'reenable';
        const amount = typeof d.amount === 'number' ? d.amount.toFixed(2) : '';
        return `
    <h1>${reenable ? s.reenableTitle : s.requestedTitle}</h1>
    <p>${reenable ? s.reenableIntro : s.requestedIntro}</p>
    <ul>
      <li>${s.shareholder}: ${sn}</li>
      ${d.label ? `<li>${s.label}: ${escapeHtml(d.label)}</li>` : ''}
      <li>${s.ogm}: ${escapeHtml(d.ogmCode)}</li>
      ${reenable ? '' : `<li>${s.amount}: €${amount}${d.isReplacement ? ` (${s.replacement})` : ''}</li>`}
    </ul>
    <p>${reenable ? s.reenableAction : s.requestedAction}</p>
  `;
      },
```

Add the copy to the four email locale files with this script (the email files round-trip through `JSON.stringify` unchanged; Setup proved it for `fr.json`, and the script checks each file before it writes):

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
node -e '
const fs = require("fs");
const copy = {
  en: { requestedTitle: "New charge card request", requestedIntro: "{shareholderName} requested a charge card.", requestedAction: "The card moves to Paid when the payment arrives. Then issue it in Admin → Charge cards.", reenableTitle: "Charge card re-enable request", reenableIntro: "{shareholderName} reports that their charge card no longer works.", reenableAction: "Re-enable the card in the provider portal, then click Done in Admin → Charge cards.", shareholder: "Shareholder", label: "Label", ogm: "Structured communication", amount: "Amount", replacement: "replacement for a lost card" },
  nl: { requestedTitle: "Nieuwe aanvraag laadpas", requestedIntro: "{shareholderName} vroeg een laadpas aan.", requestedAction: "De pas gaat naar Betaald zodra de betaling binnen is. Geef hem daarna uit via Beheer → Laadpassen.", reenableTitle: "Vraag om een laadpas opnieuw te activeren", reenableIntro: "{shareholderName} meldt dat de laadpas niet meer werkt.", reenableAction: "Activeer de pas opnieuw in het portaal van de leverancier en klik daarna op Gedaan in Beheer → Laadpassen.", shareholder: "Aandeelhouder", label: "Label", ogm: "Gestructureerde mededeling", amount: "Bedrag", replacement: "vervanging van een verloren pas" },
  fr: { requestedTitle: "Nouvelle demande de carte de recharge", requestedIntro: "{shareholderName} a demandé une carte de recharge.", requestedAction: "La carte passe à Payée dès réception du paiement. Délivrez-la ensuite via Administration → Cartes de recharge.", reenableTitle: "Demande de réactivation de carte de recharge", reenableIntro: "{shareholderName} signale que sa carte de recharge ne fonctionne plus.", reenableAction: "Réactivez la carte dans le portail du fournisseur, puis cliquez sur Fait dans Administration → Cartes de recharge.", shareholder: "Actionnaire", label: "Libellé", ogm: "Communication structurée", amount: "Montant", replacement: "remplacement d’une carte perdue" },
  de: { requestedTitle: "Neuer Antrag auf Ladekarte", requestedIntro: "{shareholderName} hat eine Ladekarte beantragt.", requestedAction: "Die Karte wechselt zu Bezahlt, sobald die Zahlung eingeht. Geben Sie sie dann unter Verwaltung → Ladekarten aus.", reenableTitle: "Antrag auf Reaktivierung einer Ladekarte", reenableIntro: "{shareholderName} meldet, dass die Ladekarte nicht mehr funktioniert.", reenableAction: "Aktivieren Sie die Karte im Portal des Anbieters erneut und klicken Sie dann unter Verwaltung → Ladekarten auf Erledigt.", shareholder: "Anteilseigner", label: "Bezeichnung", ogm: "Strukturierte Mitteilung", amount: "Betrag", replacement: "Ersatz für eine verlorene Karte" },
};
for (const [lang, entry] of Object.entries(copy)) {
  const file = `apps/api/src/modules/email/i18n/${lang}.json`;
  const text = fs.readFileSync(file, "utf8");
  const json = JSON.parse(text);
  if (text !== JSON.stringify(json, null, 2) + "\n") throw new Error(`${file} does not round-trip; edit it by hand`);
  json["charge-card-coop-notice"] = entry;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
console.log("ok");
'
```

Expected: `ok`. If it throws `does not round-trip`, add the block by hand as the last top-level key of that file.

In `apps/api/src/modules/email/email.processor.render.spec.ts`, add to `sampleData` after the `'payment-confirmed'` entry:

```ts
    'charge-card-coop-notice': {
      kind: 'requested',
      shareholderName: 'Jan Peeters',
      label: 'Auto <Anna>',
      ogmCode: '+++090/9337/55493+++',
      amount: 6,
      isReplacement: true,
    },
```

and add to `extraCases`:

```ts
    {
      name: 'charge-card-coop-notice (re-enable)',
      key: 'charge-card-coop-notice',
      data: {
        kind: 'reenable',
        shareholderName: 'Jan Peeters',
        label: null,
        ogmCode: '+++090/9337/55493+++',
        amount: 6,
        isReplacement: false,
      },
    },
```

Append this test inside the top-level `describe` of the same file:

```ts
  it('escapes the card label in the charge-card coop notice', () => {
    const html = createProcessor().renderTemplate(
      'charge-card-coop-notice',
      { ...sampleData['charge-card-coop-notice'], language: 'nl' },
      coopName,
    );
    expect(html).toContain('Auto &lt;Anna&gt;');
    expect(html).toContain('€6.00 (vervanging van een verloren pas)');
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/email/email.processor.render`
Expected: PASS with `8 snapshots written` (4 locales × 2 cases) and every existing snapshot passing unchanged. A changed existing snapshot means the edit broke another template; fix it, do not run `-u`.

- [ ] **Step 6: Write the view, transition helper, DTO and service**

Create `apps/api/src/modules/charge-cards/charge-card-view.ts`:

```ts
import type { ChargeCard } from '@opencoop/database';

export function shareholderDisplayName(sh: {
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  return sh.companyName || [sh.firstName, sh.lastName].filter(Boolean).join(' ');
}

export interface ChargeCardView {
  id: string;
  label: string | null;
  status: ChargeCard['status'];
  blockReason: ChargeCard['blockReason'];
  ogmCode: string;
  cardNumber: string | null;
  feeInclVat: number;
  isReplacement: boolean;
  replacesCardId: string | null;
  replaced: boolean;
  providerSyncNeeded: boolean;
  requestedAt: Date;
  paidAt: Date | null;
  issuedAt: Date | null;
  blockedAt: Date | null;
  activatedAt: Date | null;
}

export function toChargeCardView(card: ChargeCard & { replacedBy?: { id: string } | null }): ChargeCardView {
  return {
    id: card.id,
    label: card.label,
    status: card.status,
    blockReason: card.blockReason,
    ogmCode: card.ogmCode,
    cardNumber: card.cardNumber,
    feeInclVat: Number(card.feeInclVat),
    isReplacement: card.isReplacement,
    replacesCardId: card.replacesCardId,
    replaced: Boolean(card.replacedBy),
    providerSyncNeeded: card.providerSyncNeeded,
    requestedAt: card.requestedAt,
    paidAt: card.paidAt,
    issuedAt: card.issuedAt,
    blockedAt: card.blockedAt,
    activatedAt: card.activatedAt,
  };
}
```

Create `apps/api/src/modules/charge-cards/charge-card-transition.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChargeCard, Prisma } from '@opencoop/database';

/** A card can be reported lost while ACTIVE, or BLOCKED for any reason other than LOST. */
export const CAN_REPORT_LOST: Prisma.ChargeCardWhereInput = {
  OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }],
};

/**
 * Moves one card from an allowed state to a new state. The update is guarded
 * by `allowed` in the same statement, so two concurrent transitions (a cancel
 * and a payment, say) can never both win.
 *
 * @param scope   who may see the card (shareholder or coop); no match → 404
 * @param allowed the states this transition starts from; no match → 400
 */
export async function transitionCard(
  db: Prisma.TransactionClient,
  scope: Prisma.ChargeCardWhereInput,
  allowed: Prisma.ChargeCardWhereInput,
  data: Prisma.ChargeCardUpdateManyMutationInput,
  refusal: string,
): Promise<ChargeCard> {
  const card = await db.chargeCard.findFirst({ where: scope, select: { id: true } });
  if (!card) {
    throw new NotFoundException('Charge card not found');
  }
  const result = await db.chargeCard.updateMany({ where: { AND: [{ id: card.id }, allowed] }, data });
  if (result.count === 0) {
    throw new BadRequestException(refusal);
  }
  return db.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
}
```

Create `apps/api/src/modules/charge-cards/dto/request-charge-card.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestChargeCardDto {
  @ApiProperty({ required: false, maxLength: 60, example: 'Auto Anna' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiProperty({ required: false, description: 'Id of an own LOST card this request replaces' })
  @IsOptional()
  @IsString()
  replacesCardId?: string;
}
```

Create `apps/api/src/modules/charge-cards/charge-cards.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChargeCard, Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OgmService } from '../ogm/ogm.service';
import { EmailService } from '../email/email.service';
import { canActForShareholder } from '../shareholders/shareholder-access';
import { CAN_REPORT_LOST, transitionCard } from './charge-card-transition';
import { ChargeCardView, shareholderDisplayName, toChargeCardView } from './charge-card-view';
import { RequestChargeCardDto } from './dto/request-charge-card.dto';

const OWN_SHAREHOLDER_SELECT = {
  id: true,
  coopId: true,
  userId: true,
  type: true,
  registeredByUserId: true,
  status: true,
  firstName: true,
  lastName: true,
  companyName: true,
  coop: {
    select: {
      id: true,
      name: true,
      slug: true,
      chargeCardsEnabled: true,
      chargeCardFee: true,
      chargeCardReplacementFee: true,
      bankIban: true,
      bankBic: true,
      coopEmail: true,
    },
  },
} satisfies Prisma.ShareholderSelect;

type OwnShareholder = Prisma.ShareholderGetPayload<{ select: typeof OWN_SHAREHOLDER_SELECT }>;

export interface ChargeCardPaymentDetails {
  beneficiaryName: string;
  iban: string | null;
  bic: string | null;
  amount: number;
  ogmCode: string;
}

@Injectable()
export class ChargeCardsService {
  private readonly logger = new Logger(ChargeCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ogm: OgmService,
    private readonly email: EmailService,
  ) {}

  async listForShareholder(shareholderId: string, userId: string) {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const cards = sh.coop.chargeCardsEnabled
      ? await this.prisma.chargeCard.findMany({
          where: { shareholderId: sh.id },
          include: { replacedBy: { select: { id: true } } },
          orderBy: { requestedAt: 'desc' },
        })
      : [];
    return {
      enabled: sh.coop.chargeCardsEnabled,
      coop: { name: sh.coop.name, slug: sh.coop.slug, bankIban: sh.coop.bankIban, bankBic: sh.coop.bankBic },
      shareholderStatus: sh.status,
      fee: Number(sh.coop.chargeCardFee),
      replacementFee: Number(sh.coop.chargeCardReplacementFee),
      cards: cards.map(toChargeCardView),
    };
  }

  async request(
    shareholderId: string,
    userId: string,
    dto: RequestChargeCardDto,
  ): Promise<{ card: ChargeCardView; payment: ChargeCardPaymentDetails }> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    if (!sh.coop.chargeCardsEnabled) {
      throw new ForbiddenException('Charge cards are not enabled for this cooperative');
    }
    if (sh.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shareholders can request a charge card');
    }

    let feeInclVat = sh.coop.chargeCardFee;
    let replacesCardId: string | null = null;
    if (dto.replacesCardId) {
      const lost = await this.prisma.chargeCard.findFirst({
        where: { id: dto.replacesCardId, shareholderId: sh.id },
        include: { replacedBy: { select: { id: true } } },
      });
      if (!lost || lost.status !== 'BLOCKED' || lost.blockReason !== 'LOST') {
        throw new BadRequestException('Only your own lost card can be replaced');
      }
      if (lost.replacedBy) {
        throw new ConflictException('This card has already been replaced');
      }
      feeInclVat = sh.coop.chargeCardReplacementFee;
      replacesCardId = lost.id;
    }

    let card: ChargeCard;
    try {
      card = await this.prisma.$transaction(async (tx) => {
        const ogmCode = await this.ogm.nextOgmCode(tx, sh.coopId);
        return tx.chargeCard.create({
          data: {
            coopId: sh.coopId,
            shareholderId: sh.id,
            label: dto.label?.trim() || null,
            ogmCode,
            feeInclVat,
            isReplacement: replacesCardId !== null,
            replacesCardId,
          },
        });
      });
    } catch (err) {
      // Two concurrent replacement requests for the same lost card: the unique
      // index on replacesCardId lets exactly one through.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        String(err.meta?.target).includes('replacesCardId')
      ) {
        throw new ConflictException('This card has already been replaced');
      }
      throw err;
    }

    await this.notifyCoop(sh, 'requested', card);
    return {
      card: toChargeCardView(card),
      payment: {
        beneficiaryName: sh.coop.name,
        iban: sh.coop.bankIban,
        bic: sh.coop.bankBic,
        amount: Number(card.feeInclVat),
        ogmCode: card.ogmCode,
      },
    };
  }

  async cancel(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const card = await transitionCard(
      this.prisma,
      { id: cardId, shareholderId: sh.id },
      { status: 'REQUESTED' },
      { status: 'CANCELLED' },
      'Only a requested card can be cancelled',
    );
    return toChargeCardView(card);
  }

  async reportLost(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const card = await transitionCard(
      this.prisma,
      { id: cardId, shareholderId: sh.id },
      CAN_REPORT_LOST,
      { status: 'BLOCKED', blockReason: 'LOST', blockedAt: new Date(), providerSyncNeeded: true },
      'Only an active or blocked card can be reported lost',
    );
    return toChargeCardView(card);
  }

  /**
   * v1 manual flow: the provider expires unused cards on its own. The
   * shareholder tells us the card stopped working; the admin re-enables it in
   * the provider portal. Idempotent: a second click does not email again.
   */
  async requestReenable(shareholderId: string, userId: string, cardId: string): Promise<ChargeCardView> {
    const sh = await this.loadOwnShareholder(shareholderId, userId);
    const existing = await this.prisma.chargeCard.findFirst({ where: { id: cardId, shareholderId: sh.id } });
    if (!existing) {
      throw new NotFoundException('Charge card not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active card can be re-enabled');
    }
    if (sh.status !== 'ACTIVE') {
      throw new BadRequestException('Only active shareholders can re-enable a card');
    }
    if (existing.providerSyncNeeded) {
      return toChargeCardView(existing);
    }
    const updated = await this.prisma.chargeCard.update({
      where: { id: existing.id },
      data: { providerSyncNeeded: true, activatedAt: new Date() },
    });
    await this.notifyCoop(sh, 'reenable', updated);
    return toChargeCardView(updated);
  }

  private async loadOwnShareholder(shareholderId: string, userId: string): Promise<OwnShareholder> {
    const sh = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: OWN_SHAREHOLDER_SELECT,
    });
    if (!sh) {
      throw new NotFoundException('Shareholder not found');
    }
    if (!canActForShareholder(sh, userId)) {
      throw new ForbiddenException('You can only manage your own shareholder records');
    }
    return sh;
  }

  private async notifyCoop(sh: OwnShareholder, kind: 'requested' | 'reenable', card: ChargeCard) {
    if (!sh.coop.coopEmail) {
      this.logger.warn(`Coop ${sh.coopId} has no coopEmail; charge-card ${kind} notice not sent`);
      return;
    }
    try {
      await this.email.sendChargeCardCoopNotice(sh.coopId, sh.coop.coopEmail, {
        kind,
        shareholderName: shareholderDisplayName(sh),
        label: card.label,
        ogmCode: card.ogmCode,
        amount: Number(card.feeInclVat),
        isReplacement: card.isReplacement,
      });
    } catch (err) {
      this.logger.error(`Failed to queue charge-card ${kind} notice: ${(err as Error).message}`);
    }
  }
}
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards`
Expected: PASS, 21 tests.

- [ ] **Step 7: Add the controller and module**

Create `apps/api/src/modules/charge-cards/charge-cards.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ChargeCardsService } from './charge-cards.service';
import { RequestChargeCardDto } from './dto/request-charge-card.dto';

@ApiTags('charge-cards')
@ApiBearerAuth()
@Controller('shareholders/:shareholderId/charge-cards')
@UseGuards(JwtAuthGuard)
export class ChargeCardsController {
  constructor(private readonly chargeCards: ChargeCardsService) {}

  @Get()
  @ApiOperation({ summary: 'List own charge cards, fees and payment details' })
  list(@Param('shareholderId') shareholderId: string, @CurrentUser() user: CurrentUserData) {
    return this.chargeCards.listForShareholder(shareholderId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Request a charge card (shareholder must be ACTIVE)' })
  request(
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RequestChargeCardDto,
  ) {
    return this.chargeCards.request(shareholderId, user.id, dto);
  }

  @Post(':cardId/cancel')
  @ApiOperation({ summary: 'Cancel a requested charge card' })
  cancel(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.cancel(shareholderId, user.id, cardId);
  }

  @Post(':cardId/report-lost')
  @ApiOperation({ summary: 'Report a charge card lost (final)' })
  reportLost(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.reportLost(shareholderId, user.id, cardId);
  }

  @Post(':cardId/request-reenable')
  @ApiOperation({ summary: 'Report that an active card stopped working (admin re-enables it at the provider)' })
  requestReenable(
    @Param('shareholderId') shareholderId: string,
    @Param('cardId') cardId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.chargeCards.requestReenable(shareholderId, user.id, cardId);
  }
}
```

Create `apps/api/src/modules/charge-cards/charge-cards.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OgmModule } from '../ogm/ogm.module';
import { ChargeCardsController } from './charge-cards.controller';
import { ChargeCardsService } from './charge-cards.service';

@Module({
  imports: [EmailModule, OgmModule],
  controllers: [ChargeCardsController],
  providers: [ChargeCardsService],
})
export class ChargeCardsModule {}
```

In `apps/api/src/app.module.ts`, add `import { ChargeCardsModule } from './modules/charge-cards/charge-cards.module';` after the `McpToolsModule` import, and add `ChargeCardsModule,` to the `imports` array directly after `ShareholderStatusModule,`.

- [ ] **Step 8: Expose the settings (TDD on the DTO)**

Create `apps/api/src/modules/coops/dto/update-coop.dto.spec.ts`:

```ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCoopDto } from './update-coop.dto';

describe('UpdateCoopDto charge-card fields', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    return validate(plainToInstance(UpdateCoopDto, payload));
  }

  it('accepts the Bronsgroen values', async () => {
    expect(
      await errorsFor({ chargeCardsEnabled: true, chargeCardFee: 6, chargeCardReplacementFee: 12, chargeCardVatRate: 21 }),
    ).toHaveLength(0);
  });

  it('rejects a zero fee', async () => {
    const errors = await errorsFor({ chargeCardFee: 0 });
    expect(errors.some((e) => e.property === 'chargeCardFee')).toBe(true);
  });

  it('rejects a fee with more than two decimals', async () => {
    const errors = await errorsFor({ chargeCardReplacementFee: 12.005 });
    expect(errors.some((e) => e.property === 'chargeCardReplacementFee')).toBe(true);
  });

  it('rejects a VAT rate above 100', async () => {
    const errors = await errorsFor({ chargeCardVatRate: 121 });
    expect(errors.some((e) => e.property === 'chargeCardVatRate')).toBe(true);
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/coops/dto/update-coop.dto`
Expected: FAIL. With `forbidUnknownValues` off, unknown properties pass validation, so "rejects a zero fee" and the other two rejection tests fail with `expected true, received false`.

In `apps/api/src/modules/coops/dto/update-coop.dto.ts`, add `Max` to the `class-validator` import list, then add after the `ecoPowerMinThreshold` property:

```ts
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  chargeCardsEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Charge card fee incl. VAT (first card)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  chargeCardFee?: number;

  @ApiProperty({ required: false, description: 'Replacement fee incl. VAT (after loss or theft)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  chargeCardReplacementFee?: number;

  @ApiProperty({ required: false, description: 'VAT rate in percent; stored for later invoicing' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  chargeCardVatRate?: number;
```

In `apps/api/src/modules/coops/coops.service.ts`, `getSettings`, add after `ecoPowerMinThreshold: true,`:

```ts
        chargeCardsEnabled: true,
        chargeCardFee: true,
        chargeCardReplacementFee: true,
        chargeCardVatRate: true,
```

`CoopsService.update` already spreads the DTO into `prisma.coop.update` and audits the diff, so it needs no change.

Run: `pnpm --filter @opencoop/api exec jest src/modules/coops`
Expected: PASS.

- [ ] **Step 9: Build, full test, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/api lint
```

Expected: build exits 0; all suites pass; lint reports 0 errors.

```bash
git add apps/api/src/modules/shareholders/shareholder-access.ts \
  apps/api/src/modules/shareholders/shareholder-access.spec.ts \
  apps/api/src/modules/shareholders/shareholder-actions.controller.ts \
  apps/api/src/modules/charge-cards/charge-card-view.ts \
  apps/api/src/modules/charge-cards/charge-card-transition.ts \
  apps/api/src/modules/charge-cards/dto/request-charge-card.dto.ts \
  apps/api/src/modules/charge-cards/charge-cards.service.ts \
  apps/api/src/modules/charge-cards/charge-cards.service.spec.ts \
  apps/api/src/modules/charge-cards/charge-cards.controller.ts \
  apps/api/src/modules/charge-cards/charge-cards.module.ts \
  apps/api/src/app.module.ts \
  apps/api/src/modules/email/email.service.ts \
  apps/api/src/modules/email/email.service.charge-cards.spec.ts \
  apps/api/src/modules/email/email.processor.ts \
  apps/api/src/modules/email/email.processor.render.spec.ts \
  apps/api/src/modules/email/__snapshots__/email.processor.render.spec.ts.snap \
  apps/api/src/modules/email/i18n/nl.json apps/api/src/modules/email/i18n/en.json \
  apps/api/src/modules/email/i18n/fr.json apps/api/src/modules/email/i18n/de.json \
  apps/api/src/modules/coops/dto/update-coop.dto.ts \
  apps/api/src/modules/coops/dto/update-coop.dto.spec.ts \
  apps/api/src/modules/coops/coops.service.ts
git commit -m "feat(charge-cards): shareholders can request, cancel and report cards"
```

---
### Task 5: Charge cards accept payment

CSV import, Ponto and rematch all reach a card through `BankMatchingService` (Task 3), so the automatic path changes in one method. Manual match gets a third target, `chargeCardId`. `PaymentsService.addPayment` stays registration-only: Ponto no longer calls it, and a card fee always arrives as a bank transfer.

**Files:**
- Modify: `apps/api/src/modules/ogm/payment-target.ts` (whole file)
- Create: `apps/api/src/modules/ogm/payment-target.spec.ts`
- Modify: `apps/api/src/modules/ogm/ogm.service.ts` (cards in both resolvers, `findChargeCardTarget`), `apps/api/src/modules/ogm/ogm.service.spec.ts`
- Create: `apps/api/src/modules/charge-cards/charge-card-payments.ts`, `apps/api/src/modules/charge-cards/charge-card-payments.spec.ts`
- Modify: `apps/api/src/modules/bank-import/bank-matching.service.ts` (card branch), `apps/api/src/modules/bank-import/bank-matching.service.spec.ts`
- Modify: `apps/api/src/modules/bank-import/bank-import.service.ts` (`manualMatch`), `apps/api/src/modules/bank-import/bank-import.service.spec.ts`, `apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts` (prisma mock)
- Modify: `apps/api/src/modules/bank-import/dto/match-bank-transaction.dto.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts:948-960` (`matchBankTransaction`)

**Interfaces:**
- Consumes: Task 3 resolver and `RegistrationTarget`; Task 2 `ChargeCard`.
- Produces:
  - `ChargeCardTarget = { kind: 'chargeCard'; id; coopId; shareholderId; status: ChargeCardStatus; feeInclVat: number; ogmCode: string }`.
  - `PaymentTarget = RegistrationTarget | ChargeCardTarget`.
  - `toCents(amount: number): number`; `acceptsCardPayment(card: ChargeCardTarget, amount: number): boolean`.
  - `recordChargeCardPayment(tx: Prisma.TransactionClient, card: ChargeCardTarget, input: { amount; bankDate; bankTransactionId?; matchedByUserId? }): Promise<{ payment: Payment; paid: boolean }>`.
  - `OgmService.findChargeCardTarget(coopId: string, cardId: string): Promise<ChargeCardTarget | null>`.
  - `BankImportService.manualMatch(coopId, bankTransactionId, target: { registrationId?: string; paymentId?: string; chargeCardId?: string }, userId)`: exactly one id.
  - `MatchBankTransactionDto { registrationId?; paymentId?; chargeCardId? }`, so `POST /admin/coops/:coopId/bank-transactions/:id/match` accepts `{ chargeCardId }`.

- [ ] **Step 1: Write the failing rule tests**

Create `apps/api/src/modules/ogm/payment-target.spec.ts`:

```ts
import { ChargeCardTarget, acceptsCardPayment, toCents } from './payment-target';

const card = (overrides: Partial<ChargeCardTarget> = {}): ChargeCardTarget => ({
  kind: 'chargeCard',
  id: 'card-1',
  coopId: 'coop-1',
  shareholderId: 'sh-1',
  status: 'REQUESTED',
  feeInclVat: 6,
  ogmCode: '+++090/9337/55493+++',
  ...overrides,
});

describe('acceptsCardPayment', () => {
  it('accepts a REQUESTED card paid in full', () => {
    expect(acceptsCardPayment(card(), 6)).toBe(true);
  });

  it('accepts an overpayment', () => {
    expect(acceptsCardPayment(card(), 10)).toBe(true);
  });

  it('refuses a short payment', () => {
    expect(acceptsCardPayment(card(), 5.99)).toBe(false);
  });

  it('compares in cents, not floats', () => {
    expect(acceptsCardPayment(card({ feeInclVat: 6.05 }), 0.1 + 0.2 + 5.75)).toBe(true);
  });

  it.each(['PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED'] as const)('refuses a %s card', (status) => {
    expect(acceptsCardPayment(card({ status }), 6)).toBe(false);
  });
});

describe('toCents', () => {
  it('rounds to whole cents', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(12)).toBe(1200);
  });
});
```

Create `apps/api/src/modules/charge-cards/charge-card-payments.spec.ts`:

```ts
import { recordChargeCardPayment } from './charge-card-payments';
import { ChargeCardTarget } from '../ogm/payment-target';

const card: ChargeCardTarget = {
  kind: 'chargeCard',
  id: 'card-1',
  coopId: 'coop-1',
  shareholderId: 'sh-1',
  status: 'REQUESTED',
  feeInclVat: 6.05,
  ogmCode: '+++090/9337/55493+++',
};

describe('recordChargeCardPayment', () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-1' }), findMany: jest.fn() },
      chargeCard: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('books the payment on the card and marks it PAID once the fee is reached', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: '6.05' }]);

    const result = await recordChargeCardPayment(tx, card, {
      amount: 6.05,
      bankDate: new Date('2026-10-06'),
      bankTransactionId: 'btx-1',
      matchedByUserId: 'user-1',
    });

    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        chargeCardId: 'card-1',
        coopId: 'coop-1',
        amount: 6.05,
        bankDate: new Date('2026-10-06'),
        bankTransactionId: 'btx-1',
        matchedByUserId: 'user-1',
        matchedAt: expect.any(Date),
      },
    });
    expect(tx.chargeCard.updateMany).toHaveBeenCalledWith({
      where: { id: 'card-1', status: 'REQUESTED' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(result).toEqual({ payment: { id: 'pay-1' }, paid: true });
  });

  it('keeps the card REQUESTED while the payments are short', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 3 }]);

    const result = await recordChargeCardPayment(tx, card, { amount: 3, bankDate: new Date() });

    expect(tx.chargeCard.updateMany).not.toHaveBeenCalled();
    expect(result.paid).toBe(false);
  });

  it('adds up partial payments in cents', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 0.1 }, { amount: 0.2 }, { amount: 5.75 }]);

    const result = await recordChargeCardPayment(tx, card, { amount: 5.75, bankDate: new Date() });

    expect(result.paid).toBe(true);
  });

  it('reports paid=false when the card was cancelled in the meantime', async () => {
    tx.payment.findMany.mockResolvedValue([{ amount: 6.05 }]);
    tx.chargeCard.updateMany.mockResolvedValue({ count: 0 });

    const result = await recordChargeCardPayment(tx, card, { amount: 6.05, bankDate: new Date() });

    expect(result.paid).toBe(false);
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/payment-target src/modules/charge-cards/charge-card-payments`
Expected: FAIL — `ChargeCardTarget`, `acceptsCardPayment` and `toCents` are not exported, and `./charge-card-payments` does not exist.

- [ ] **Step 2: Widen the target types and add the card payment rule**

Replace `apps/api/src/modules/ogm/payment-target.ts` with:

```ts
import type { ChargeCardStatus } from '@opencoop/database';

/**
 * Something a bank payment can be booked on. A registration keeps the shape
 * BankMatchingService works with; a charge card carries its frozen fee.
 */
export interface RegistrationTarget {
  kind: 'registration';
  id: string;
  coopId: string;
  status: string;
  totalAmount?: unknown;
  ogmCode?: string | null;
  payments?: { id: string; amount: unknown; bankDate: Date; bankTransactionId: string | null }[];
}

export interface ChargeCardTarget {
  kind: 'chargeCard';
  id: string;
  coopId: string;
  shareholderId: string;
  status: ChargeCardStatus;
  feeInclVat: number;
  ogmCode: string;
}

export type PaymentTarget = RegistrationTarget | ChargeCardTarget;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * True when CSV import, Ponto or rematch may book this amount on the card
 * without an admin: the card is REQUESTED and the amount covers its fee.
 * Short payments and payments for any other state stay UNMATCHED.
 */
export function acceptsCardPayment(card: ChargeCardTarget, amount: number): boolean {
  return card.status === 'REQUESTED' && toCents(amount) >= toCents(card.feeInclVat);
}
```

Create `apps/api/src/modules/charge-cards/charge-card-payments.ts`:

```ts
import { Prisma } from '@opencoop/database';
import { computeTotalPaid } from '@opencoop/shared';
import { ChargeCardTarget, toCents } from '../ogm/payment-target';

export interface ChargeCardPaymentInput {
  amount: number;
  bankDate: Date;
  bankTransactionId?: string | null;
  matchedByUserId?: string | null;
}

/**
 * Books a payment on a REQUESTED charge card inside the caller's transaction.
 * The card moves to PAID once its payments reach feeInclVat (in cents). The
 * status update is guarded on REQUESTED, so a card cancelled in the meantime
 * stays CANCELLED (paid = false) and an admin refunds the money.
 */
export async function recordChargeCardPayment(
  tx: Prisma.TransactionClient,
  card: ChargeCardTarget,
  input: ChargeCardPaymentInput,
) {
  const payment = await tx.payment.create({
    data: {
      chargeCardId: card.id,
      coopId: card.coopId,
      amount: input.amount,
      bankDate: input.bankDate,
      bankTransactionId: input.bankTransactionId ?? null,
      matchedByUserId: input.matchedByUserId ?? null,
      matchedAt: new Date(),
    },
  });

  const payments = await tx.payment.findMany({ where: { chargeCardId: card.id }, select: { amount: true } });
  if (toCents(computeTotalPaid(payments)) < toCents(card.feeInclVat)) {
    return { payment, paid: false };
  }

  const result = await tx.chargeCard.updateMany({
    where: { id: card.id, status: 'REQUESTED' },
    data: { status: 'PAID', paidAt: new Date() },
  });
  return { payment, paid: result.count === 1 };
}
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/payment-target src/modules/charge-cards/charge-card-payments`
Expected: PASS, 13 tests. (The bank-import suites do not compile yet: `registration.payments` in `bank-matching.service.ts` does not exist on `ChargeCardTarget`. Step 4 fixes it.)

- [ ] **Step 3: Resolve charge cards (TDD)**

In `apps/api/src/modules/ogm/ogm.service.spec.ts`, inside `describe('OgmService resolvers')`:

1. In `beforeEach`, add to the `prisma` object:

```ts
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
```

2. Append these tests at the end of that `describe`:

```ts
  const CARD_OGM = '+++001/0000/04221+++';
  const cardRow = {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    status: 'REQUESTED',
    feeInclVat: new Prisma.Decimal('6.00'),
    ogmCode: CARD_OGM,
  };
  const cardTarget = { ...cardRow, kind: 'chargeCard', feeInclVat: 6 };

  it('resolves a charge-card OGM in the same batch, scoped to the coop', async () => {
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.chargeCard.findMany.mockResolvedValue([cardRow]);

    const targets = await service.resolveOgmTargets('coop-1', ['001000004221']);

    expect(prisma.chargeCard.findMany.mock.calls[0][0].where).toEqual({
      coopId: 'coop-1',
      ogmCode: { in: [CARD_OGM] },
    });
    expect(targets.get(CARD_OGM)).toEqual(cardTarget);
  });

  it('resolveOgmTarget falls back to a charge card when no registration has the OGM', async () => {
    prisma.registration.findFirst.mockResolvedValue(null);
    prisma.chargeCard.findFirst.mockResolvedValue(cardRow);

    await expect(service.resolveOgmTarget('coop-1', CARD_OGM)).resolves.toEqual(cardTarget);
    expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ coopId: 'coop-1', ogmCode: CARD_OGM });
  });

  it('findChargeCardTarget looks a card up by id within the coop', async () => {
    prisma.chargeCard.findFirst.mockResolvedValue(cardRow);

    await expect(service.findChargeCardTarget('coop-1', 'card-1')).resolves.toEqual(cardTarget);
    expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ id: 'card-1', coopId: 'coop-1' });
  });
```

`+++001/0000/04221+++` is `generateOgmCode('001', 42)` (check digits `0010000042 mod 97 = 21`).

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm/ogm.service.spec`
Expected: FAIL — `prisma.chargeCard.findMany.mock.calls[0]` is undefined, and `service.findChargeCardTarget is not a function`.

In `apps/api/src/modules/ogm/ogm.service.ts`:

1. Change the payment-target import to `import { ChargeCardTarget, PaymentTarget, RegistrationTarget } from './payment-target';`.
2. Add below `toRegistrationTarget`:

```ts
const CHARGE_CARD_TARGET_SELECT = {
  id: true,
  coopId: true,
  shareholderId: true,
  status: true,
  feeInclVat: true,
  ogmCode: true,
} satisfies Prisma.ChargeCardSelect;

type ChargeCardTargetRow = Prisma.ChargeCardGetPayload<{ select: typeof CHARGE_CARD_TARGET_SELECT }>;

function toChargeCardTarget(row: ChargeCardTargetRow): ChargeCardTarget {
  return {
    kind: 'chargeCard',
    id: row.id,
    coopId: row.coopId,
    shareholderId: row.shareholderId,
    status: row.status,
    feeInclVat: Number(row.feeInclVat),
    ogmCode: row.ogmCode,
  };
}
```

3. In `resolveOgmTargets`, replace the `registrations` query and its loop with:

```ts
    const [registrations, chargeCards] = await Promise.all([
      this.prisma.registration.findMany({
        where: { coopId, ogmCode: { in: codes } },
        select: REGISTRATION_TARGET_SELECT,
      }),
      this.prisma.chargeCard.findMany({
        where: { coopId, ogmCode: { in: codes } },
        select: CHARGE_CARD_TARGET_SELECT,
      }),
    ]);
    for (const row of registrations) {
      if (row.ogmCode) targets.set(row.ogmCode, toRegistrationTarget(row));
    }
    for (const row of chargeCards) {
      targets.set(row.ogmCode, toChargeCardTarget(row));
    }
```

4. In `resolveOgmTarget`, replace `return registration ? toRegistrationTarget(registration) : null;` with:

```ts
    if (registration) return toRegistrationTarget(registration);
    const card = await this.prisma.chargeCard.findFirst({
      where: { coopId, ogmCode },
      select: CHARGE_CARD_TARGET_SELECT,
    });
    return card ? toChargeCardTarget(card) : null;
```

5. Add after `resolveOgmTarget`:

```ts
  /** Looks a charge card up by id, scoped to the coop (manual match). */
  async findChargeCardTarget(coopId: string, cardId: string): Promise<ChargeCardTarget | null> {
    const card = await this.prisma.chargeCard.findFirst({
      where: { id: cardId, coopId },
      select: CHARGE_CARD_TARGET_SELECT,
    });
    return card ? toChargeCardTarget(card) : null;
  }
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/ogm`
Expected: PASS.

- [ ] **Step 4: The matcher books card payments (TDD)**

In `apps/api/src/modules/bank-import/bank-matching.service.spec.ts`:

1. Add `import { Prisma } from '@opencoop/database';` and `import { ChargeCardTarget } from '../ogm/payment-target';`.
2. In the `prisma` mock of `beforeEach`, add `create: jest.fn().mockResolvedValue({ id: 'pay-card' }),` to `payment`, and add:

```ts
      chargeCard: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
```

3. Append before the final `});`:

```ts
  describe('charge cards', () => {
    const cardRow = {
      id: 'card-1',
      coopId: 'coop-1',
      shareholderId: 'sh-1',
      status: 'REQUESTED',
      feeInclVat: new Prisma.Decimal('6.00'),
      ogmCode: OGM,
    };
    const cardTx = { ...bankTransaction, amount: 6 };

    beforeEach(() => {
      prisma.registration.findFirst.mockResolvedValue(null);
      prisma.chargeCard.findFirst.mockResolvedValue(cardRow);
      prisma.payment.findMany.mockResolvedValue([{ amount: 6 }]);
    });

    it('AUTO_MATCHES a payment of at least the fee and marks the card PAID', async () => {
      const result = await service.matchTransaction('coop-1', cardTx, 'user-1');

      expect(result).toEqual({ status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true });
      expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'bank-tx-1', matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'AUTO_MATCHED', ogmCode: OGM },
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chargeCardId: 'card-1',
          coopId: 'coop-1',
          amount: 6,
          bankTransactionId: 'bank-tx-1',
          matchedByUserId: 'user-1',
        }),
      });
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'card-1', status: 'REQUESTED' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(paymentsService.addPayment).not.toHaveBeenCalled();
    });

    it('leaves a short payment UNMATCHED', async () => {
      const result = await service.matchTransaction('coop-1', { ...cardTx, amount: 5 });

      expect(result.status).toBe('UNMATCHED');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.bankTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('leaves a payment for a CANCELLED card UNMATCHED', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ ...cardRow, status: 'CANCELLED' });

      await expect(service.matchTransaction('coop-1', cardTx)).resolves.toMatchObject({ status: 'UNMATCHED' });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('books nothing when auto-match is off (Ponto with autoMatchPayments = false)', async () => {
      await expect(service.matchTransaction('coop-1', cardTx, undefined, false)).resolves.toMatchObject({
        status: 'UNMATCHED',
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('second transfer for a paid card stays UNMATCHED', async () => {
      // The CSV import hands the same cached target to every row of the file.
      const cached: ChargeCardTarget = {
        kind: 'chargeCard',
        id: 'card-1',
        coopId: 'coop-1',
        shareholderId: 'sh-1',
        status: 'REQUESTED',
        feeInclVat: 6,
        ogmCode: OGM,
      };

      const first = await service.matchTransaction('coop-1', cardTx, 'user-1', true, cached);
      const second = await service.matchTransaction('coop-1', { ...cardTx, id: 'bank-tx-2' }, 'user-1', true, cached);

      expect(first.status).toBe('AUTO_MATCHED');
      expect(second.status).toBe('UNMATCHED');
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
      expect(cached.status).toBe('PAID');
    });
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import/bank-matching`
Expected: FAIL — ts-jest reports `TS2339: Property 'payments' does not exist on type 'ChargeCardTarget'` in `bank-matching.service.ts`.

In `apps/api/src/modules/bank-import/bank-matching.service.ts`:

1. Change the payment-target import to `import { ChargeCardTarget, PaymentTarget, acceptsCardPayment } from '../ogm/payment-target';` and add `import { recordChargeCardPayment } from '../charge-cards/charge-card-payments';`.
2. In `matchTransaction`, directly after the `if (!target) { ... }` block and before `const registration = target;`, add:

```ts
    if (target.kind === 'chargeCard') {
      return this.matchChargeCard(target, transaction, ogmCode, amount, matchedByUserId, allowCreate);
    }
```

3. Add this method directly above `private toCents`:

```ts
  /**
   * A charge card takes a payment only while REQUESTED and only for at least its
   * fee. Anything else stays UNMATCHED for an admin (refund or manual match).
   */
  private async matchChargeCard(
    card: ChargeCardTarget,
    transaction: BankTransactionMatchInput,
    ogmCode: string,
    amount: number,
    matchedByUserId: string | undefined,
    allowCreate: boolean,
  ): Promise<BankTransactionMatchResult> {
    if (!allowCreate || !acceptsCardPayment(card, amount)) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    const paid = await this.prisma
      .$transaction(async (tx) => {
        // Claim the bank row first, so a concurrent linker cannot book it twice.
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: transaction.id, matchStatus: 'UNMATCHED' },
          data: { matchStatus: 'AUTO_MATCHED', ogmCode },
        });
        if (claimed.count !== 1) throw new LinkConflictError();
        const result = await recordChargeCardPayment(tx, card, {
          amount,
          bankDate: transaction.date,
          bankTransactionId: transaction.id,
          matchedByUserId,
        });
        return result.paid;
      })
      .catch((error: unknown) => {
        if (error instanceof LinkConflictError) return null;
        throw error;
      });
    if (paid === null) {
      return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
    }

    // The CSV import reuses this object for later rows: a second transfer must see PAID.
    if (paid) card.status = 'PAID';
    return { status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true };
  }
```

After the early return, TypeScript narrows `target` to `RegistrationTarget`, so the registration code below compiles unchanged.

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import/bank-matching`
Expected: PASS, including the 5 new charge-card tests.

- [ ] **Step 5: Manual match books on a card (TDD)**

The resolvers now query `chargeCard` whenever no registration matches, so the two other bank-import specs need a `chargeCard` mock:

- In `apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts`, add to the `prisma` object: `chargeCard: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },`.
- In `apps/api/src/modules/bank-import/bank-import.service.spec.ts`, add to the `prisma` object:

```ts
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
```

In `apps/api/src/modules/bank-import/bank-import.service.spec.ts`, change the `@nestjs/common` import to `import { BadRequestException, NotFoundException } from '@nestjs/common';` and append before the final `});`:

```ts
  describe('manual match to a charge card', () => {
    const CARD = { id: 'card-1', coopId: COOP_ID, shareholderId: 'sh-1', status: 'REQUESTED', feeInclVat: 6, ogmCode: OGM };

    beforeEach(() => {
      prisma.bankTransaction.findFirst.mockResolvedValue({
        id: 'btx-1',
        coopId: COOP_ID,
        matchStatus: 'UNMATCHED',
        amount: 3,
        date: new Date('2026-10-06'),
      });
      prisma.chargeCard.findFirst.mockResolvedValue(CARD);
      prisma.payment.findMany.mockResolvedValue([{ amount: 3 }]);
    });

    it('books a short payment on a REQUESTED card without marking it PAID', async () => {
      await expect(
        service.manualMatch(COOP_ID, 'btx-1', { chargeCardId: 'card-1' }, IMPORTER_ID),
      ).resolves.toEqual({ success: true });

      expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ id: 'card-1', coopId: COOP_ID });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chargeCardId: 'card-1',
          amount: 3,
          bankTransactionId: 'btx-1',
          matchedByUserId: IMPORTER_ID,
        }),
      });
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
      expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'btx-1', matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'MANUAL_MATCHED' },
      });
    });

    it('marks the card PAID once its payments reach the fee', async () => {
      prisma.payment.findMany.mockResolvedValue([{ amount: 3 }, { amount: 3 }]);

      await service.manualMatch(COOP_ID, 'btx-1', { chargeCardId: 'card-1' }, IMPORTER_ID);

      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'card-1', status: 'REQUESTED' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
    });

    it('refuses a card that is not REQUESTED', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ ...CARD, status: 'PAID' });

      await expect(
        service.manualMatch(COOP_ID, 'btx-1', { chargeCardId: 'card-1' }, IMPORTER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('returns 404 for a card of another coop', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(null);

      await expect(
        service.manualMatch(COOP_ID, 'btx-1', { chargeCardId: 'card-1' }, IMPORTER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses a registration and a card at once', async () => {
      await expect(
        service.manualMatch(COOP_ID, 'btx-1', { registrationId: 'reg-1', chargeCardId: 'card-1' }, IMPORTER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import`
Expected: FAIL — ts-jest reports `TS2353: Object literal may only specify known properties, and 'chargeCardId' does not exist` on the new `manualMatch` calls.

In `apps/api/src/modules/bank-import/bank-import.service.ts`:

1. Add `import { recordChargeCardPayment } from '../charge-cards/charge-card-payments';`.
2. In `manualMatch`, change the parameter `target: { registrationId?: string; paymentId?: string },` to `target: { registrationId?: string; paymentId?: string; chargeCardId?: string },`.
3. Replace:

```ts
    const { registrationId, paymentId } = target;
    if ((registrationId && paymentId) || (!registrationId && !paymentId)) {
      throw new BadRequestException('Provide either registrationId or paymentId');
    }
```

with:

```ts
    const { registrationId, paymentId, chargeCardId } = target;
    if ([registrationId, paymentId, chargeCardId].filter(Boolean).length !== 1) {
      throw new BadRequestException('Provide exactly one of registrationId, paymentId and chargeCardId');
    }
```

4. Directly after the `if (bankTx.matchStatus !== 'UNMATCHED') { ... }` block and before `if (paymentId) {`, add:

```ts
    if (chargeCardId) {
      const card = await this.ogm.findChargeCardTarget(coopId, chargeCardId);
      if (!card) {
        throw new NotFoundException('Charge card not found');
      }
      if (card.status !== 'REQUESTED') {
        throw new BadRequestException('Only a requested charge card accepts a payment');
      }
      // Any amount: an admin may book a partial payment. The card turns PAID once
      // its payments reach the fee.
      await this.prisma.$transaction(async (tx) => {
        const claimedTransaction = await tx.bankTransaction.updateMany({
          where: { id: bankTransactionId, matchStatus: 'UNMATCHED' },
          data: { matchStatus: 'MANUAL_MATCHED' },
        });
        if (claimedTransaction.count !== 1) {
          throw new ConflictException('Bank transaction was linked in the meantime');
        }
        await recordChargeCardPayment(tx, card, {
          amount: Number(bankTx.amount),
          bankDate: bankTx.date,
          bankTransactionId,
          matchedByUserId: userId,
        });
      });
      return { success: true };
    }
```

Replace `apps/api/src/modules/bank-import/dto/match-bank-transaction.dto.ts` with:

```ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Exactly one of the three is required; the service rejects any other combination with a 400.
export class MatchBankTransactionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  registrationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  chargeCardId?: string;
}
```

In `apps/api/src/modules/admin/admin.controller.ts`, `matchBankTransaction`, change `{ registrationId: dto.registrationId, paymentId: dto.paymentId },` to `{ registrationId: dto.registrationId, paymentId: dto.paymentId, chargeCardId: dto.chargeCardId },`. The MCP tool `match_bank_transaction` (`mcp-bank.tools.ts:112`) keeps sending `{ registrationId }`; it needs no change.

Run: `pnpm --filter @opencoop/api exec jest src/modules/bank-import src/modules/ogm src/modules/charge-cards src/modules/ponto src/modules/payments src/modules/mcp src/modules/admin`
Expected: PASS, including the 5 new manual-match tests.

- [ ] **Step 6: Build, full test, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/api lint
```

Expected: build exits 0; all suites pass; lint 0 errors.

```bash
git add apps/api/src/modules/ogm/payment-target.ts apps/api/src/modules/ogm/payment-target.spec.ts \
  apps/api/src/modules/ogm/ogm.service.ts apps/api/src/modules/ogm/ogm.service.spec.ts \
  apps/api/src/modules/charge-cards/charge-card-payments.ts \
  apps/api/src/modules/charge-cards/charge-card-payments.spec.ts \
  apps/api/src/modules/bank-import/bank-matching.service.ts \
  apps/api/src/modules/bank-import/bank-matching.service.spec.ts \
  apps/api/src/modules/bank-import/bank-import.service.ts \
  apps/api/src/modules/bank-import/bank-import.service.spec.ts \
  apps/api/src/modules/bank-import/bank-reconciliation.service.spec.ts \
  apps/api/src/modules/bank-import/dto/match-bank-transaction.dto.ts \
  apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat(charge-cards): a matched fee payment moves a requested card to paid"
```

---

### Task 6: Admin endpoints and the "card issued" email

**Files:**
- Create: `apps/api/src/modules/charge-cards/working-days.ts`, `apps/api/src/modules/charge-cards/working-days.spec.ts`
- Create: `apps/api/src/modules/charge-cards/charge-cards-admin.service.ts`, `apps/api/src/modules/charge-cards/charge-cards-admin.service.spec.ts`
- Create: `apps/api/src/modules/charge-cards/charge-cards-admin.controller.ts`
- Create: `apps/api/src/modules/charge-cards/dto/issue-charge-card.dto.ts`, `apps/api/src/modules/charge-cards/dto/list-charge-cards.query.ts`
- Modify: `apps/api/src/modules/charge-cards/charge-cards.module.ts`
- Modify: `apps/api/src/modules/email/email.service.ts`, `apps/api/src/modules/email/email.service.charge-cards.spec.ts`
- Modify: `apps/api/src/modules/email/email.processor.ts`, `apps/api/src/modules/email/email.processor.render.spec.ts`, `apps/api/src/modules/email/i18n/{nl,en,fr,de}.json`

**Interfaces:**
- Consumes: `transitionCard`, `CAN_REPORT_LOST`, `toChargeCardView`, `shareholderDisplayName` (Task 4); `resolveShareholderEmail` from `apps/api/src/modules/shareholders/shareholder-email.resolver.ts`.
- Produces:
  - `workingDaysBetween(from: Date, to: Date): number`, `isOverdue(waitingSince: Date, now: Date): boolean`, `PROCESSING_WORKING_DAYS = 5`.
  - `AdminChargeCardRow = ChargeCardView & { shareholderId; shareholderName; shareholderStatus; totalPaid: number; waitingWorkingDays: number | null; overdue: boolean }`.
  - `ChargeCardsAdminService`: `list(coopId, { status?, todo? }, now?)`, `issue(coopId, cardId, cardNumber)`, `block`, `unblock`, `markLost`, `markProviderSyncDone`, `cancel` (all `(coopId, cardId)`).
  - HTTP (`canManageShareholders`): `GET /admin/coops/:coopId/charge-cards?status=&todo=true`, `POST .../:id/issue { cardNumber }`, `POST .../:id/block`, `.../:id/unblock`, `.../:id/mark-lost`, `.../:id/provider-sync-done`, `.../:id/cancel`.
  - `EmailService.sendChargeCardIssued(coopId, to, { shareholderName; label: string | null; cardNumber; dashboardUrl })`, template key `charge-card-issued`.

- [ ] **Step 1: Write the failing working-day tests**

Create `apps/api/src/modules/charge-cards/working-days.spec.ts` (2026-10-05 is a Monday):

```ts
import { isOverdue, workingDaysBetween } from './working-days';

const d = (iso: string) => new Date(iso);

describe('workingDaysBetween', () => {
  it('is 0 on the same day', () => {
    expect(workingDaysBetween(d('2026-10-05T08:00:00Z'), d('2026-10-05T17:00:00Z'))).toBe(0);
  });

  it('counts Monday to next Monday as 5', () => {
    expect(workingDaysBetween(d('2026-10-05T08:00:00Z'), d('2026-10-12T08:00:00Z'))).toBe(5);
  });

  it('counts Friday to Monday as 1', () => {
    expect(workingDaysBetween(d('2026-10-09T16:00:00Z'), d('2026-10-12T09:00:00Z'))).toBe(1);
  });

  it('counts Saturday to Monday as 1', () => {
    expect(workingDaysBetween(d('2026-10-10T10:00:00Z'), d('2026-10-12T09:00:00Z'))).toBe(1);
  });

  it('counts Friday to Sunday as 0', () => {
    expect(workingDaysBetween(d('2026-10-09T10:00:00Z'), d('2026-10-11T10:00:00Z'))).toBe(0);
  });

  it('ignores the time of day', () => {
    expect(workingDaysBetween(d('2026-10-05T23:59:00Z'), d('2026-10-06T00:01:00Z'))).toBe(1);
  });

  it('is 0 when the end lies before the start', () => {
    expect(workingDaysBetween(d('2026-10-12T08:00:00Z'), d('2026-10-05T08:00:00Z'))).toBe(0);
  });
});

describe('isOverdue', () => {
  it('is false at exactly 5 working days', () => {
    expect(isOverdue(d('2026-10-05T08:00:00Z'), d('2026-10-12T08:00:00Z'))).toBe(false);
  });

  it('is true from the 6th working day', () => {
    expect(isOverdue(d('2026-10-05T08:00:00Z'), d('2026-10-13T08:00:00Z'))).toBe(true);
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards/working-days`
Expected: FAIL — `Cannot find module './working-days'`.

- [ ] **Step 2: Implement working days**

Create `apps/api/src/modules/charge-cards/working-days.ts`:

```ts
const DAY_MS = 86_400_000;

/** Bronsgroen policy: a card is processed within 5 working days. */
export const PROCESSING_WORKING_DAYS = 5;

/**
 * Counts Monday-to-Friday calendar days after `from`, up to and including
 * `to`. Uses UTC calendar dates; public holidays are not excluded.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let count = 0;
  for (let day = start + DAY_MS; day <= end; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

export function isOverdue(waitingSince: Date, now: Date): boolean {
  return workingDaysBetween(waitingSince, now) > PROCESSING_WORKING_DAYS;
}
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards/working-days`
Expected: PASS, 9 tests.

- [ ] **Step 3: Write the failing admin-service tests**

Create `apps/api/src/modules/charge-cards/charge-cards-admin.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { ChargeCardsAdminService } from './charge-cards-admin.service';

const OGM = '+++090/9337/55493+++';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    coopId: 'coop-1',
    shareholderId: 'sh-1',
    label: 'Auto Anna',
    status: 'PAID',
    blockReason: null,
    ogmCode: OGM,
    cardNumber: null,
    feeInclVat: new Prisma.Decimal('6.00'),
    isReplacement: false,
    replacesCardId: null,
    providerSyncNeeded: false,
    requestedAt: new Date('2026-10-01T08:00:00Z'),
    paidAt: new Date('2026-10-12T08:00:00Z'),
    issuedAt: null,
    blockedAt: null,
    activatedAt: null,
    shareholder: {
      firstName: 'Jan',
      lastName: 'Peeters',
      companyName: null,
      status: 'ACTIVE',
      email: 'jan@example.com',
      user: null,
    },
    payments: [{ amount: new Prisma.Decimal('6.00') }],
    ...overrides,
  };
}

describe('ChargeCardsAdminService', () => {
  let prisma: any;
  let email: { sendChargeCardIssued: jest.Mock };
  let service: ChargeCardsAdminService;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://opencoop.test';
    prisma = {
      chargeCard: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    email = { sendChargeCardIssued: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsAdminService(prisma, email as any);
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  describe('list', () => {
    const now = new Date('2026-10-13T09:00:00Z'); // Tuesday

    it('adds waiting working days and flags overdue REQUESTED and PAID cards', async () => {
      prisma.chargeCard.findMany.mockResolvedValue([
        card({ id: 'r', status: 'REQUESTED', paidAt: null, requestedAt: new Date('2026-10-05T08:00:00Z'), payments: [] }),
        card({ id: 'p', status: 'PAID', paidAt: new Date('2026-10-12T08:00:00Z') }),
        card({ id: 'a', status: 'ACTIVE', cardNumber: 'NL-1' }),
      ]);

      const rows = await service.list('coop-1', {}, now);

      expect(rows.map((r) => [r.id, r.waitingWorkingDays, r.overdue])).toEqual([
        ['r', 6, true],
        ['p', 1, false],
        ['a', null, false],
      ]);
      expect(rows[1]).toMatchObject({ shareholderName: 'Jan Peeters', shareholderStatus: 'ACTIVE', totalPaid: 6, feeInclVat: 6 });
    });

    it('filters on status and on the provider to-do flag, within the coop', async () => {
      await service.list('coop-1', { status: 'BLOCKED', todo: true }, now);

      expect(prisma.chargeCard.findMany.mock.calls[0][0].where).toEqual({
        coopId: 'coop-1',
        status: 'BLOCKED',
        providerSyncNeeded: true,
      });
    });
  });

  describe('issue', () => {
    it('trims the card number, activates the card and emails the shareholder', async () => {
      prisma.chargeCard.findFirst.mockResolvedValueOnce(card()).mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'ACTIVE', cardNumber: 'NL-123' }));

      const result = await service.issue('coop-1', 'card-1', '  NL-123 ');

      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: 'card-1' }, { status: 'PAID' }] },
        data: {
          status: 'ACTIVE',
          cardNumber: 'NL-123',
          issuedAt: expect.any(Date),
          activatedAt: expect.any(Date),
          providerSyncNeeded: false,
        },
      });
      expect(email.sendChargeCardIssued).toHaveBeenCalledWith('coop-1', 'jan@example.com', {
        shareholderName: 'Jan Peeters',
        label: 'Auto Anna',
        cardNumber: 'NL-123',
        dashboardUrl: 'https://opencoop.test/dashboard/charge-cards',
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('refuses a blank card number without touching the database', async () => {
      await expect(service.issue('coop-1', 'card-1', '   ')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for a card of another coop', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(null);

      await expect(service.issue('coop-1', 'card-9', 'NL-1')).rejects.toThrow(NotFoundException);
      expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ id: 'card-9', coopId: 'coop-1' });
    });

    it('refuses a card that is not PAID', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(card({ status: 'REQUESTED' }));

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to issue to a shareholder who is no longer ACTIVE', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue(
        card({ shareholder: { ...card().shareholder, status: 'INACTIVE' } }),
      );

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(BadRequestException);
      expect(prisma.chargeCard.updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 when the card number is already used in the coop', async () => {
      prisma.chargeCard.findFirst.mockResolvedValueOnce(card()).mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.2.0',
          meta: { target: ['coopId', 'cardNumber'] },
        }),
      );

      await expect(service.issue('coop-1', 'card-1', 'NL-1')).rejects.toThrow(ConflictException);
    });

    it('issues without an email when the shareholder has no address', async () => {
      prisma.chargeCard.findFirst
        .mockResolvedValueOnce(card({ shareholder: { ...card().shareholder, email: null, user: null } }))
        .mockResolvedValueOnce({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card({ status: 'ACTIVE', cardNumber: 'NL-1' }));

      await service.issue('coop-1', 'card-1', 'NL-1');

      expect(email.sendChargeCardIssued).not.toHaveBeenCalled();
    });
  });

  describe('state changes', () => {
    beforeEach(() => {
      prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.chargeCard.findUniqueOrThrow.mockResolvedValue(card());
    });

    const lastUpdate = () => prisma.chargeCard.updateMany.mock.calls[0][0];

    it('block: ACTIVE → BLOCKED/ADMIN and flags the provider sync', async () => {
      await service.block('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { status: 'ACTIVE' }] },
        data: { status: 'BLOCKED', blockReason: 'ADMIN', blockedAt: expect.any(Date), providerSyncNeeded: true },
      });
    });

    it('unblock: only an ADMIN block of an ACTIVE shareholder; sets activatedAt and the sync flag', async () => {
      await service.unblock('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: {
          AND: [{ id: 'card-1' }, { status: 'BLOCKED', blockReason: 'ADMIN', shareholder: { status: 'ACTIVE' } }],
        },
        data: {
          status: 'ACTIVE',
          blockReason: null,
          blockedAt: null,
          activatedAt: expect.any(Date),
          providerSyncNeeded: true,
        },
      });
    });

    it('unblock refuses a NO_SHARES or LOST block', async () => {
      prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unblock('coop-1', 'card-1')).rejects.toThrow(BadRequestException);
    });

    it('markLost uses the shared lost rule', async () => {
      await service.markLost('coop-1', 'card-1');

      expect(lastUpdate().where).toEqual({
        AND: [{ id: 'card-1' }, { OR: [{ status: 'ACTIVE' }, { status: 'BLOCKED', blockReason: { not: 'LOST' } }] }],
      });
      expect(lastUpdate().data).toMatchObject({ status: 'BLOCKED', blockReason: 'LOST', providerSyncNeeded: true });
    });

    it('markProviderSyncDone clears the flag', async () => {
      await service.markProviderSyncDone('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { providerSyncNeeded: true }] },
        data: { providerSyncNeeded: false },
      });
    });

    it('cancel: REQUESTED or PAID → CANCELLED', async () => {
      await service.cancel('coop-1', 'card-1');

      expect(lastUpdate()).toEqual({
        where: { AND: [{ id: 'card-1' }, { status: { in: ['REQUESTED', 'PAID'] } }] },
        data: { status: 'CANCELLED' },
      });
    });

    it('scopes every change to the coop', async () => {
      await service.block('coop-1', 'card-1');

      expect(prisma.chargeCard.findFirst.mock.calls[0][0].where).toEqual({ id: 'card-1', coopId: 'coop-1' });
    });
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards/charge-cards-admin`
Expected: FAIL — `Cannot find module './charge-cards-admin.service'`.

- [ ] **Step 4: Add the "card issued" email**

Append to `apps/api/src/modules/email/email.service.charge-cards.spec.ts`, inside the `describe`:

```ts
  it('queues the card-issued email in the recipient language', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ preferredLanguage: 'de' }) },
      emailLog: { create: jest.fn().mockResolvedValue({ id: 'log-2' }) },
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new EmailService(prisma as any, queue as any);

    await service.sendChargeCardIssued('coop-1', 'jan@example.com', {
      shareholderName: 'Jan Peeters',
      label: 'Auto Anna',
      cardNumber: 'NL-123',
      dashboardUrl: 'https://opencoop.test/dashboard/charge-cards',
    });

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        subject: 'Ihre Ladekarte ist bereit',
        templateKey: 'charge-card-issued',
        templateData: expect.objectContaining({ language: 'de', cardNumber: 'NL-123' }),
      }),
    );
  });
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/email/email.service.charge-cards`
Expected: FAIL — `service.sendChargeCardIssued is not a function`.

Add to `apps/api/src/modules/email/email.service.ts`, after `sendChargeCardCoopNotice`:

```ts
  async sendChargeCardIssued(
    coopId: string,
    to: string,
    data: { shareholderName: string; label: string | null; cardNumber: string; dashboardUrl: string },
  ) {
    const language = await this.resolveRecipientLanguage(to);
    const subjects: Record<string, string> = {
      nl: 'Je laadpas is klaar',
      en: 'Your charge card is ready',
      fr: 'Votre carte de recharge est prête',
      de: 'Ihre Ladekarte ist bereit',
    };
    return this.send({
      coopId,
      to,
      subject: subjects[language] || subjects['nl'],
      templateKey: 'charge-card-issued',
      templateData: { ...data, language },
    });
  }
```

In `apps/api/src/modules/email/email.processor.ts`, add after the `'charge-card-coop-notice'` template:

```ts
      'charge-card-issued': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const s = buildCopy('charge-card-issued', lang, {
          coopName: escapeHtml(cn),
          shareholderName: escapeHtml(d.shareholderName),
        });
        return `
    <h1>${s.title}</h1>
    <p>${s.dear}</p>
    <p>${s.intro}</p>
    <ul>
      ${d.label ? `<li>${s.label}: ${escapeHtml(d.label)}</li>` : ''}
      <li>${s.cardNumber}: <strong>${escapeHtml(d.cardNumber)}</strong></li>
    </ul>
    ${d.dashboardUrl ? `
    <p style="text-align: center; margin: 30px 0;">
      <a href="${d.dashboardUrl}"
         style="background-color: #1e40af; color: white; padding: 12px 24px;
                text-decoration: none; border-radius: 6px; display: inline-block;">
        ${s.dashboard}
      </a>
    </p>
    ` : ''}
    <p>${s.thanks}</p>
  `;
      },
```

Add the copy:

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
node -e '
const fs = require("fs");
const copy = {
  en: { title: "Your charge card is ready", dear: "Dear {shareholderName},", intro: "Your charge card has been issued and activated. You can start charging.", label: "Label", cardNumber: "Card number", dashboard: "View my charge cards", thanks: "Kind regards, {coopName}" },
  nl: { title: "Je laadpas is klaar", dear: "Beste {shareholderName},", intro: "Je laadpas is uitgegeven en geactiveerd. Je kunt nu laden.", label: "Label", cardNumber: "Kaartnummer", dashboard: "Bekijk mijn laadpassen", thanks: "Met vriendelijke groeten, {coopName}" },
  fr: { title: "Votre carte de recharge est prête", dear: "Cher/Chère {shareholderName},", intro: "Votre carte de recharge a été délivrée et activée. Vous pouvez commencer à recharger.", label: "Libellé", cardNumber: "Numéro de carte", dashboard: "Voir mes cartes de recharge", thanks: "Cordialement, {coopName}" },
  de: { title: "Ihre Ladekarte ist bereit", dear: "Liebe/r {shareholderName},", intro: "Ihre Ladekarte wurde ausgegeben und aktiviert. Sie können jetzt laden.", label: "Bezeichnung", cardNumber: "Kartennummer", dashboard: "Meine Ladekarten ansehen", thanks: "Mit freundlichen Grüßen, {coopName}" },
};
for (const [lang, entry] of Object.entries(copy)) {
  const file = `apps/api/src/modules/email/i18n/${lang}.json`;
  const text = fs.readFileSync(file, "utf8");
  const json = JSON.parse(text);
  if (text !== JSON.stringify(json, null, 2) + "\n") throw new Error(`${file} does not round-trip; edit it by hand`);
  json["charge-card-issued"] = entry;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
console.log("ok");
'
```

Expected: `ok`.

In `apps/api/src/modules/email/email.processor.render.spec.ts`, add to `sampleData`:

```ts
    'charge-card-issued': {
      shareholderName: 'Jan Peeters',
      label: 'Auto <Anna>',
      cardNumber: 'NL-ABC-123',
      dashboardUrl: 'https://opencoop.test/dashboard/charge-cards',
    },
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/email`
Expected: PASS; `4 snapshots written`; every other snapshot unchanged.

- [ ] **Step 5: Implement the admin service, DTOs and controller**

Create `apps/api/src/modules/charge-cards/charge-cards-admin.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChargeCard, ChargeCardStatus, Prisma, ShareholderStatus } from '@opencoop/database';
import { computeTotalPaid } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';
import { CAN_REPORT_LOST, transitionCard } from './charge-card-transition';
import { ChargeCardView, shareholderDisplayName, toChargeCardView } from './charge-card-view';
import { isOverdue, workingDaysBetween } from './working-days';

export interface AdminChargeCardRow extends ChargeCardView {
  shareholderId: string;
  shareholderName: string;
  shareholderStatus: ShareholderStatus;
  totalPaid: number;
  /** Working days since the request (REQUESTED) or the payment (PAID); null otherwise. */
  waitingWorkingDays: number | null;
  overdue: boolean;
}

@Injectable()
export class ChargeCardsAdminService {
  private readonly logger = new Logger(ChargeCardsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async list(
    coopId: string,
    filter: { status?: ChargeCardStatus; todo?: boolean },
    now: Date = new Date(),
  ): Promise<AdminChargeCardRow[]> {
    const cards = await this.prisma.chargeCard.findMany({
      where: {
        coopId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.todo ? { providerSyncNeeded: true } : {}),
      },
      include: {
        shareholder: { select: { firstName: true, lastName: true, companyName: true, status: true } },
        payments: { select: { amount: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });

    return cards.map((card) => {
      const waitingSince =
        card.status === 'REQUESTED' ? card.requestedAt : card.status === 'PAID' ? (card.paidAt ?? card.requestedAt) : null;
      return {
        ...toChargeCardView(card),
        shareholderId: card.shareholderId,
        shareholderName: shareholderDisplayName(card.shareholder),
        shareholderStatus: card.shareholder.status,
        totalPaid: computeTotalPaid(card.payments),
        waitingWorkingDays: waitingSince ? workingDaysBetween(waitingSince, now) : null,
        overdue: waitingSince !== null && isOverdue(waitingSince, now),
      };
    });
  }

  async issue(coopId: string, cardId: string, rawCardNumber: string): Promise<ChargeCardView> {
    const cardNumber = rawCardNumber.trim();
    if (!cardNumber) {
      throw new BadRequestException('Card number is required');
    }
    const card = await this.prisma.chargeCard.findFirst({
      where: { id: cardId, coopId },
      include: {
        shareholder: {
          select: {
            status: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
            user: { select: { email: true } },
          },
        },
      },
    });
    if (!card) {
      throw new NotFoundException('Charge card not found');
    }
    if (card.status !== 'PAID') {
      throw new BadRequestException('Only a paid card can be issued');
    }
    if (card.shareholder.status !== 'ACTIVE') {
      throw new BadRequestException('The shareholder is no longer active; cancel the card instead');
    }

    const now = new Date();
    let issued: ChargeCard;
    try {
      issued = await transitionCard(
        this.prisma,
        { id: card.id, coopId },
        { status: 'PAID' },
        { status: 'ACTIVE', cardNumber, issuedAt: now, activatedAt: now, providerSyncNeeded: false },
        'Only a paid card can be issued',
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This card number is already used in this cooperative');
      }
      throw err;
    }

    const to = resolveShareholderEmail(card.shareholder);
    if (to) {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
      try {
        await this.email.sendChargeCardIssued(coopId, to, {
          shareholderName: shareholderDisplayName(card.shareholder),
          label: issued.label,
          cardNumber,
          dashboardUrl: `${baseUrl}/dashboard/charge-cards`,
        });
      } catch (err) {
        this.logger.error(`Failed to queue charge-card issued email: ${(err as Error).message}`);
      }
    }
    return toChargeCardView(issued);
  }

  async block(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await transitionCard(
        this.prisma,
        { id: cardId, coopId },
        { status: 'ACTIVE' },
        { status: 'BLOCKED', blockReason: 'ADMIN', blockedAt: new Date(), providerSyncNeeded: true },
        'Only an active card can be blocked',
      ),
    );
  }

  /** Lifts an ADMIN block. NO_SHARES lifts itself (sync job); LOST never lifts. */
  async unblock(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await transitionCard(
        this.prisma,
        { id: cardId, coopId },
        { status: 'BLOCKED', blockReason: 'ADMIN', shareholder: { status: 'ACTIVE' } },
        { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: new Date(), providerSyncNeeded: true },
        'Only a card blocked by an admin, of an active shareholder, can be unblocked',
      ),
    );
  }

  async markLost(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await transitionCard(
        this.prisma,
        { id: cardId, coopId },
        CAN_REPORT_LOST,
        { status: 'BLOCKED', blockReason: 'LOST', blockedAt: new Date(), providerSyncNeeded: true },
        'Only an active or blocked card can be marked lost',
      ),
    );
  }

  async markProviderSyncDone(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await transitionCard(
        this.prisma,
        { id: cardId, coopId },
        { providerSyncNeeded: true },
        { providerSyncNeeded: false },
        'This card has no pending provider change',
      ),
    );
  }

  /** A PAID card can be cancelled too (shareholder left); the refund happens outside OpenCoop. */
  async cancel(coopId: string, cardId: string): Promise<ChargeCardView> {
    return toChargeCardView(
      await transitionCard(
        this.prisma,
        { id: cardId, coopId },
        { status: { in: ['REQUESTED', 'PAID'] } },
        { status: 'CANCELLED' },
        'Only a requested or paid card can be cancelled',
      ),
    );
  }
}
```

Create `apps/api/src/modules/charge-cards/dto/issue-charge-card.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class IssueChargeCardDto {
  @ApiProperty({ description: 'Printed card number or RFID UID', example: 'NL-ABC-123' })
  @IsString()
  @MaxLength(64)
  cardNumber: string;
}
```

Create `apps/api/src/modules/charge-cards/dto/list-charge-cards.query.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { ChargeCardStatus } from '@opencoop/database';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class ListChargeCardsQueryDto {
  @ApiProperty({ required: false, enum: ChargeCardStatus })
  @IsOptional()
  @IsEnum(ChargeCardStatus)
  status?: ChargeCardStatus;

  // A string, not a boolean: enableImplicitConversion turns "false" into true.
  @ApiProperty({ required: false, enum: ['true', 'false'], description: 'Only cards with a pending provider-portal change' })
  @IsOptional()
  @IsIn(['true', 'false'])
  todo?: string;
}
```

Create `apps/api/src/modules/charge-cards/charge-cards-admin.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { ChargeCardsAdminService } from './charge-cards-admin.service';
import { IssueChargeCardDto } from './dto/issue-charge-card.dto';
import { ListChargeCardsQueryDto } from './dto/list-charge-cards.query';

@ApiTags('charge-cards-admin')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/charge-cards')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, PermissionGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
@RequirePermission('canManageShareholders')
export class ChargeCardsAdminController {
  constructor(private readonly admin: ChargeCardsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List charge cards with waiting time; filter by status or provider to-do' })
  list(@Param('coopId') coopId: string, @Query() query: ListChargeCardsQueryDto) {
    return this.admin.list(coopId, { status: query.status, todo: query.todo === 'true' });
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue a paid card: record its number, activate it, email the shareholder' })
  issue(@Param('coopId') coopId: string, @Param('id') id: string, @Body() dto: IssueChargeCardDto) {
    return this.admin.issue(coopId, id, dto.cardNumber);
  }

  @Post(':id/block')
  @ApiOperation({ summary: 'Block an active card (reason ADMIN)' })
  block(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.block(coopId, id);
  }

  @Post(':id/unblock')
  @ApiOperation({ summary: 'Lift an ADMIN block' })
  unblock(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.unblock(coopId, id);
  }

  @Post(':id/mark-lost')
  @ApiOperation({ summary: 'Mark a card lost (final)' })
  markLost(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markLost(coopId, id);
  }

  @Post(':id/provider-sync-done')
  @ApiOperation({ summary: 'Confirm the change was made in the provider portal' })
  markProviderSyncDone(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.markProviderSyncDone(coopId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a requested or paid card' })
  cancel(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.admin.cancel(coopId, id);
  }
}
```

Replace `apps/api/src/modules/charge-cards/charge-cards.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OgmModule } from '../ogm/ogm.module';
import { ChargeCardsController } from './charge-cards.controller';
import { ChargeCardsService } from './charge-cards.service';
import { ChargeCardsAdminController } from './charge-cards-admin.controller';
import { ChargeCardsAdminService } from './charge-cards-admin.service';

@Module({
  imports: [EmailModule, OgmModule],
  controllers: [ChargeCardsController, ChargeCardsAdminController],
  providers: [ChargeCardsService, ChargeCardsAdminService],
})
export class ChargeCardsModule {}
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards`
Expected: PASS (shareholder, payments, working days, admin specs).

- [ ] **Step 6: Build, full test, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/api lint
```

Expected: build exits 0; all suites pass; lint 0 errors.

```bash
git add apps/api/src/modules/charge-cards/working-days.ts \
  apps/api/src/modules/charge-cards/working-days.spec.ts \
  apps/api/src/modules/charge-cards/charge-cards-admin.service.ts \
  apps/api/src/modules/charge-cards/charge-cards-admin.service.spec.ts \
  apps/api/src/modules/charge-cards/charge-cards-admin.controller.ts \
  apps/api/src/modules/charge-cards/dto/issue-charge-card.dto.ts \
  apps/api/src/modules/charge-cards/dto/list-charge-cards.query.ts \
  apps/api/src/modules/charge-cards/charge-cards.module.ts \
  apps/api/src/modules/email/email.service.ts \
  apps/api/src/modules/email/email.service.charge-cards.spec.ts \
  apps/api/src/modules/email/email.processor.ts \
  apps/api/src/modules/email/email.processor.render.spec.ts \
  apps/api/src/modules/email/__snapshots__/email.processor.render.spec.ts.snap \
  apps/api/src/modules/email/i18n/nl.json apps/api/src/modules/email/i18n/en.json \
  apps/api/src/modules/email/i18n/fr.json apps/api/src/modules/email/i18n/de.json
git commit -m "feat(charge-cards): admins issue, block, unblock and cancel cards"
```

---

### Task 7: NO_SHARES sync

**Files:**
- Create: `apps/api/src/modules/charge-cards/charge-card-sync.service.ts`, `apps/api/src/modules/charge-cards/charge-card-sync.service.spec.ts`
- Create: `apps/api/src/modules/charge-cards/charge-card-sync.module.ts`
- Create: `apps/api/src/modules/charge-cards/charge-card-sync.db.spec.ts`
- Modify: `apps/api/src/modules/shareholder-status/shareholder-status.service.ts` (constructor, `recompute`)
- Modify: `apps/api/src/modules/shareholder-status/shareholder-status.scheduler.ts`
- Modify: `apps/api/src/modules/shareholder-status/shareholder-status.module.ts`
- Modify: `apps/api/src/modules/shareholder-status/shareholder-status.service.spec.ts`
- Create: `apps/api/src/modules/shareholder-status/shareholder-status.scheduler.spec.ts`

**Interfaces:**
- Consumes: `ChargeCard` model (Task 2); `createTestChargeCard` (Task 2).
- Produces:
  - `ChargeCardSyncResult = { blocked: number; unblocked: number; cancelled: number }`.
  - `ChargeCardSyncService.syncShareholder(shareholderId: string): Promise<ChargeCardSyncResult>`, `ChargeCardSyncService.syncAll(): Promise<ChargeCardSyncResult>`.
  - `ChargeCardSyncModule` (exports `ChargeCardSyncService`), imported by `ShareholderStatusModule`.

The rule compares state, not events. The nightly `reconcileAll()` is raw SQL and admin edits write `status` directly, so a hook in `recompute()` alone would miss changes. The scheduler runs `syncAll()` right after `reconcileAll()`, so the order inside one night is guaranteed. `recompute()` calls `syncShareholder()` for immediacy.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/api/src/modules/charge-cards/charge-card-sync.service.spec.ts`:

```ts
import { ChargeCardSyncService } from './charge-card-sync.service';

describe('ChargeCardSyncService', () => {
  let prisma: any;
  let service: ChargeCardSyncService;

  beforeEach(() => {
    prisma = {
      chargeCard: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 3 }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new ChargeCardSyncService(prisma);
  });

  it('blocks, unblocks and cancels in one transaction and reports the counts', async () => {
    await expect(service.syncAll()).resolves.toEqual({ blocked: 2, unblocked: 1, cancelled: 3 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const [block, unblock, cancel] = prisma.chargeCard.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(block).toEqual({
      where: { status: 'ACTIVE', shareholder: { status: { not: 'ACTIVE' } } },
      data: { status: 'BLOCKED', blockReason: 'NO_SHARES', blockedAt: expect.any(Date), providerSyncNeeded: true },
    });
    expect(unblock).toEqual({
      where: { status: 'BLOCKED', blockReason: 'NO_SHARES', shareholder: { status: 'ACTIVE' } },
      data: { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: expect.any(Date), providerSyncNeeded: true },
    });
    expect(cancel).toEqual({
      where: { status: 'REQUESTED', shareholder: { status: { not: 'ACTIVE' } } },
      data: { status: 'CANCELLED' },
    });
  });

  it('scopes every statement to one shareholder', async () => {
    await service.syncShareholder('sh-1');

    for (const [args] of prisma.chargeCard.updateMany.mock.calls) {
      expect(args.where.shareholderId).toBe('sh-1');
    }
  });
});
```

Append to `apps/api/src/modules/shareholder-status/shareholder-status.service.spec.ts`:

1. Add `import { ChargeCardSyncService } from '../charge-cards/charge-card-sync.service';` to the imports.
2. Add `let chargeCardSync: { syncShareholder: jest.Mock };` below `let audienceQueue: any;`.
3. In `beforeEach`, add `chargeCardSync = { syncShareholder: jest.fn().mockResolvedValue({ blocked: 0, unblocked: 0, cancelled: 0 }) };` and the provider `{ provide: ChargeCardSyncService, useValue: chargeCardSync },`.
4. Append before the final `});`:

```ts
  it('syncs the shareholder charge cards when the status changes', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.ACTIVE,
      registrations: [
        { type: 'BUY', status: 'COMPLETED', quantity: 10 },
        { type: 'SELL', status: 'COMPLETED', quantity: 10 },
      ],
    });

    await expect(service.recompute('sh1')).resolves.toBe(ShareholderStatus.INACTIVE);
    expect(chargeCardSync.syncShareholder).toHaveBeenCalledWith('sh1');
  });

  it('does not sync charge cards when the status is unchanged', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.ACTIVE,
      registrations: [{ type: 'BUY', status: 'COMPLETED', quantity: 10 }],
    });

    await service.recompute('sh1');

    expect(chargeCardSync.syncShareholder).not.toHaveBeenCalled();
  });

  it('keeps the new status when the charge-card sync fails', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.PENDING,
      registrations: [{ type: 'BUY', status: 'COMPLETED', quantity: 10 }],
    });
    chargeCardSync.syncShareholder.mockRejectedValue(new Error('db down'));

    await expect(service.recompute('sh1')).resolves.toBe(ShareholderStatus.ACTIVE);
    expect(prisma.shareholder.update).toHaveBeenCalled();
  });
```

Create `apps/api/src/modules/shareholder-status/shareholder-status.scheduler.spec.ts`:

```ts
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import { ShareholderStatusScheduler } from './shareholder-status.scheduler';

describe('ShareholderStatusScheduler.nightlyTick', () => {
  it('reconciles statuses first, then syncs charge cards', async () => {
    const order: string[] = [];
    const statuses = { reconcileAll: jest.fn(async () => { order.push('reconcile'); return 0; }) };
    const cards = { syncAll: jest.fn(async () => { order.push('cards'); return { blocked: 0, unblocked: 0, cancelled: 0 }; }) };

    await new ShareholderStatusScheduler(statuses as any, cards as any).nightlyTick();

    expect(order).toEqual(['reconcile', 'cards']);
  });

  it('still syncs charge cards when the reconcile fails', async () => {
    const statuses = { reconcileAll: jest.fn().mockRejectedValue(new Error('boom')) };
    const cards = { syncAll: jest.fn().mockResolvedValue({ blocked: 0, unblocked: 0, cancelled: 0 }) };

    await new ShareholderStatusScheduler(statuses as any, cards as any).nightlyTick();

    expect(cards.syncAll).toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards/charge-card-sync src/modules/shareholder-status`
Expected: FAIL — `Cannot find module './charge-card-sync.service'` (and the same import error in the shareholder-status specs).

- [ ] **Step 2: Implement the sync service and wire it in**

Create `apps/api/src/modules/charge-cards/charge-card-sync.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';

export interface ChargeCardSyncResult {
  blocked: number;
  unblocked: number;
  cancelled: number;
}

/**
 * Keeps charge cards in line with shareholder status (state, not events):
 * - ACTIVE card, shareholder not ACTIVE        → BLOCKED / NO_SHARES
 * - BLOCKED / NO_SHARES, shareholder ACTIVE    → ACTIVE (activatedAt = now)
 * - REQUESTED card, shareholder not ACTIVE     → CANCELLED
 * Block and unblock set providerSyncNeeded: in v1 an admin mirrors them in
 * the provider portal.
 */
@Injectable()
export class ChargeCardSyncService {
  private readonly logger = new Logger(ChargeCardSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  syncShareholder(shareholderId: string): Promise<ChargeCardSyncResult> {
    return this.sync({ shareholderId });
  }

  syncAll(): Promise<ChargeCardSyncResult> {
    return this.sync({});
  }

  private async sync(scope: Prisma.ChargeCardWhereInput): Promise<ChargeCardSyncResult> {
    const now = new Date();
    const [blocked, unblocked, cancelled] = await this.prisma.$transaction([
      this.prisma.chargeCard.updateMany({
        where: { ...scope, status: 'ACTIVE', shareholder: { status: { not: 'ACTIVE' } } },
        data: { status: 'BLOCKED', blockReason: 'NO_SHARES', blockedAt: now, providerSyncNeeded: true },
      }),
      this.prisma.chargeCard.updateMany({
        where: { ...scope, status: 'BLOCKED', blockReason: 'NO_SHARES', shareholder: { status: 'ACTIVE' } },
        data: { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: now, providerSyncNeeded: true },
      }),
      this.prisma.chargeCard.updateMany({
        where: { ...scope, status: 'REQUESTED', shareholder: { status: { not: 'ACTIVE' } } },
        data: { status: 'CANCELLED' },
      }),
    ]);
    const result = { blocked: blocked.count, unblocked: unblocked.count, cancelled: cancelled.count };
    if (result.blocked || result.unblocked || result.cancelled) {
      this.logger.log(
        `Charge-card sync: ${result.blocked} blocked, ${result.unblocked} unblocked, ${result.cancelled} cancelled`,
      );
    }
    return result;
  }
}
```

Create `apps/api/src/modules/charge-cards/charge-card-sync.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ChargeCardSyncService } from './charge-card-sync.service';

/** Separate from ChargeCardsModule so ShareholderStatusModule can use it without the controllers and email. */
@Module({
  providers: [ChargeCardSyncService],
  exports: [ChargeCardSyncService],
})
export class ChargeCardSyncModule {}
```

In `apps/api/src/modules/shareholder-status/shareholder-status.module.ts`, add `import { ChargeCardSyncModule } from '../charge-cards/charge-card-sync.module';` and change `imports` to `[BullModule.registerQueue({ name: 'audience-sync' }), ChargeCardSyncModule]`.

In `apps/api/src/modules/shareholder-status/shareholder-status.service.ts`:

1. Add `import { ChargeCardSyncService } from '../charge-cards/charge-card-sync.service';`.
2. Add `private readonly chargeCardSync: ChargeCardSyncService,` as the last constructor parameter.
3. In `recompute`, directly before the final `return status;`, add:

```ts
    try {
      await this.chargeCardSync.syncShareholder(shareholder.id);
    } catch (err) {
      // The nightly sync catches up; a failed card sync must not undo a status change.
      this.logger.warn(`charge-card sync failed for ${shareholder.id}: ${(err as Error).message}`);
    }
```

Replace `apps/api/src/modules/shareholder-status/shareholder-status.scheduler.ts` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ShareholderStatusService } from './shareholder-status.service';
import { ChargeCardSyncService } from '../charge-cards/charge-card-sync.service';

@Injectable()
export class ShareholderStatusScheduler {
  private readonly logger = new Logger(ShareholderStatusScheduler.name);

  constructor(
    private readonly shareholderStatusService: ShareholderStatusService,
    private readonly chargeCardSync: ChargeCardSyncService,
  ) {}

  @Cron('30 2 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick(): Promise<void> {
    try {
      await this.shareholderStatusService.reconcileAll();
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to reconcile shareholder statuses: ${(error as Error).message}`);
    }

    // After the reconcile, so cards follow tonight's statuses. Runs even if the
    // reconcile failed: card state then follows the statuses already stored.
    try {
      await this.chargeCardSync.syncAll();
    } catch (error) {
      Sentry.captureException(error);
      this.logger.error(`Failed to sync charge cards: ${(error as Error).message}`);
    }
  }
}
```

Run: `pnpm --filter @opencoop/api exec jest src/modules/charge-cards/charge-card-sync src/modules/shareholder-status`
Expected: PASS.

- [ ] **Step 3: Prove the relation filters against Postgres**

`updateMany` with a relation filter (`shareholder: { status: ... }`) is the part a mock cannot prove. Create `apps/api/src/modules/charge-cards/charge-card-sync.db.spec.ts`:

```ts
import { PrismaClient } from '@opencoop/database';
import { ChargeCardSyncService } from './charge-card-sync.service';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('ChargeCardSyncService (database)', () => {
  let prisma: PrismaClient;
  let sync: ChargeCardSyncService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    sync = new ChargeCardSyncService(prisma as any);
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('blocks, unblocks and cancels by shareholder status, and leaves other cards alone', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const gone = await createTestShareholder(prisma, coop.id, 'INACTIVE');
    const back = await createTestShareholder(prisma, coop.id, 'ACTIVE');

    const activeOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'ACTIVE' });
    const requestedOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'REQUESTED' });
    const lostOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'BLOCKED', blockReason: 'LOST' });
    const noSharesOfBack = await createTestChargeCard(prisma, coop.id, back.id, { status: 'BLOCKED', blockReason: 'NO_SHARES' });
    const adminBlockOfBack = await createTestChargeCard(prisma, coop.id, back.id, { status: 'BLOCKED', blockReason: 'ADMIN' });

    const result = await sync.syncShareholder(gone.id);
    expect(result).toEqual({ blocked: 1, unblocked: 0, cancelled: 1 });
    await sync.syncShareholder(back.id);

    const read = (id: string) => prisma.chargeCard.findUniqueOrThrow({ where: { id } });
    expect(await read(activeOfGone.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'NO_SHARES', providerSyncNeeded: true });
    expect(await read(requestedOfGone.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await read(lostOfGone.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'LOST' });
    expect(await read(noSharesOfBack.id)).toMatchObject({ status: 'ACTIVE', blockReason: null, providerSyncNeeded: true });
    expect((await read(noSharesOfBack.id)).activatedAt).not.toBeNull();
    expect(await read(adminBlockOfBack.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'ADMIN' });
  });

  it('keeps providerSyncNeeded when the status flaps before the admin acts', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id, 'ACTIVE');
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id, { status: 'ACTIVE' });

    await prisma.shareholder.update({ where: { id: shareholder.id }, data: { status: 'INACTIVE' } });
    await sync.syncAll();
    await prisma.shareholder.update({ where: { id: shareholder.id }, data: { status: 'ACTIVE' } });
    await sync.syncAll();

    expect(await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      status: 'ACTIVE',
      blockReason: null,
      providerSyncNeeded: true,
    });
  });
});
```

Run:

```bash
docker compose -f docker-compose.test.yml up -d --force-recreate --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma db push --skip-generate --accept-data-loss
TEST_DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/api exec jest --runInBand db.spec
```

Expected: PASS — `ogm.db.spec` (2), `payments.db.spec` (3), `charge-card-sync.db.spec` (2).

- [ ] **Step 4: Build, full test, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/api lint
```

Expected: build exits 0; all suites pass; lint 0 errors.

```bash
git add apps/api/src/modules/charge-cards/charge-card-sync.service.ts \
  apps/api/src/modules/charge-cards/charge-card-sync.service.spec.ts \
  apps/api/src/modules/charge-cards/charge-card-sync.module.ts \
  apps/api/src/modules/charge-cards/charge-card-sync.db.spec.ts \
  apps/api/src/modules/shareholder-status/shareholder-status.service.ts \
  apps/api/src/modules/shareholder-status/shareholder-status.service.spec.ts \
  apps/api/src/modules/shareholder-status/shareholder-status.scheduler.ts \
  apps/api/src/modules/shareholder-status/shareholder-status.scheduler.spec.ts \
  apps/api/src/modules/shareholder-status/shareholder-status.module.ts
git commit -m "feat(charge-cards): block and unblock cards as shareholder status changes"
```

---
### Task 8: Web — shareholder charge-cards page, nav entry, and login that keeps the deep link

Today no login path returns a user to the page they asked for: the dashboard layout sends a logged-out visitor to `/login`, and every login flow ends in `router.push('/dashboard')`. The bronsgroen.be button must land on the charge-cards page, so this task adds a post-login redirect. It works for every login method (password, passkey, magic link in a new tab, OAuth), because the dashboard layout consumes it after any login.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:406-444` (coop selects in `getProfile`) and `:523-530` (SYSTEM_ADMIN coop select)
- Create: `apps/web/src/lib/post-login-redirect.ts`
- Create: `apps/web/src/lib/query-string.ts`
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx`
- Modify: `apps/web/src/app/[locale]/(auth)/login/page.tsx`
- Modify: `apps/web/src/components/auth/coop-login-content.tsx`
- Modify: `apps/web/src/app/[locale]/[coopSlug]/login/page.tsx`, `apps/web/src/app/[locale]/[coopSlug]/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/charge-cards/page.tsx`
- Modify: `apps/web/messages/{en,nl,fr,de}.json` (new top-level `chargeCards` namespace, including the admin and settings strings Task 9 uses)
- Create: `e2e/helpers/charge-cards.ts`
- Create: `e2e/tests/shareholder/charge-cards.spec.ts`, `e2e/tests/public/charge-cards-login-redirect.spec.ts`

**Interfaces:**
- Consumes: `GET/POST /shareholders/:shareholderId/charge-cards[...]` (Task 4).
- Produces:
  - `/auth/me` → `shareholderCoops[].chargeCardsEnabled`, `adminCoops[].chargeCardsEnabled`.
  - `rememberPostLoginRedirect(path: string | null | undefined): void`, `consumePostLoginRedirect(): string | null`, `isSafeRedirectPath(path): path is string` (only `/dashboard...` paths, optional locale prefix, 30-minute TTL, key `opencoop-post-login-redirect`).
  - `toQueryString(params: Record<string, string | string[] | undefined>): string`.
  - Route `/[locale]/dashboard/charge-cards`.
  - e2e helpers `API_URL`, `tokenFor(role)`, `apiAs(role, method, path, body?)`, `enableChargeCards(): Promise<string>` (returns the demo coop id).

- [ ] **Step 1: Write the failing e2e specs**

Create `e2e/helpers/charge-cards.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

export const API_URL = process.env.API_URL || 'http://localhost:3001';

type Role = 'admin' | 'shareholder';

/**
 * A fresh access token for a role, from the refresh token that global-setup
 * stored in .auth/<role>.json. No extra login: /auth/login is throttled to
 * 5 per minute, and global-setup already uses 2.
 */
export async function tokenFor(role: Role): Promise<string> {
  const file = path.resolve(__dirname, '..', '.auth', `${role}.json`);
  const state = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  const refreshToken = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'refreshToken')?.value;
  if (!refreshToken) throw new Error(`${file} has no refreshToken`);
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error(`refresh for ${role} failed: ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export async function apiAs<T>(role: Role, method: 'GET' | 'POST' | 'PUT', urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${await tokenFor(role)}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${urlPath} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Turns charge cards on for the seeded demo coop and returns its id. */
export async function enableChargeCards(): Promise<string> {
  const me = await apiAs<{ adminCoops: Array<{ id: string; slug: string }> }>('admin', 'GET', '/auth/me');
  const coop = me.adminCoops.find((c) => c.slug === 'demo');
  if (!coop) throw new Error('the e2e admin has no access to the demo coop');
  await apiAs('admin', 'PUT', `/admin/coops/${coop.id}/settings`, { chargeCardsEnabled: true });
  return coop.id;
}
```

Create `e2e/tests/shareholder/charge-cards.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { enableChargeCards } from '../../helpers/charge-cards';

test.describe('Shareholder charge cards', () => {
  test.beforeAll(async () => {
    await enableChargeCards();
  });

  test('requests a card, sees the payment details, and cancels the request', async ({ page }) => {
    const label = `E2E auto ${Date.now()}`;
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/nl/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Laadpassen' }).click();
    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards$/);
    await expect(page.locator('main').getByRole('heading', { name: 'Laadpassen' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Pas aanvragen' }).click();
    const requestDialog = page.getByRole('dialog');
    await requestDialog.getByLabel('Label (optioneel)').fill(label);
    await requestDialog.getByRole('button', { name: 'Aanvraag versturen' }).click();

    const payDialog = page.getByRole('dialog');
    await expect(payDialog.getByRole('heading', { name: 'Betaal je laadpas' })).toBeVisible();
    await expect(payDialog.getByTestId('charge-card-ogm')).toHaveText(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
    await expect(payDialog.getByText(/6[,.]00/)).toBeVisible();
    await payDialog.getByRole('button', { name: 'Sluiten', exact: true }).click();

    const card = page.getByTestId('charge-card').filter({ hasText: label });
    await expect(card.getByText('Aangevraagd', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Aanvraag annuleren' }).click();
    await expect(card.getByText('Geannuleerd', { exact: true })).toBeVisible();
  });
});
```

Create `e2e/tests/public/charge-cards-login-redirect.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Login keeps the charge-cards deep link', () => {
  test('a logged-out visit goes to login and remembers the page', async ({ page }) => {
    await page.goto('/nl/dashboard/charge-cards');

    await expect(page).toHaveURL(/\/nl\/login$/);
    const stored = await page.evaluate(() => localStorage.getItem('opencoop-post-login-redirect'));
    expect(JSON.parse(stored ?? '{}').path).toBe('/nl/dashboard/charge-cards');
  });

  test('the branded coop login returns the shareholder to the charge-cards page', async ({ page }) => {
    await page.goto('/nl/demo/login?redirect=%2Fnl%2Fdashboard%2Fcharge-cards');
    await expect(page).toHaveURL(/\/nl\/demo\/default\/login\?redirect=/);

    await page.locator('input[name="email"]').fill('jan.peeters@email.be');
    await page.getByRole('button', { name: 'Doorgaan' }).click();
    await page.getByRole('button', { name: 'Gebruik wachtwoord' }).click();
    await page.locator('input[name="password"]').fill('demo1234');
    await page.getByRole('button', { name: 'Inloggen' }).click();

    await expect(page).toHaveURL(/\/nl\/dashboard\/charge-cards$/, { timeout: 15_000 });
  });
});
```

Prepare the e2e DB and run them. Stop any `pnpm dev` you have running first: Playwright reuses a running server, and yours points at the dev DB.

```bash
pnpm test:e2e:setup
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec tsx prisma/seed-demo.ts
cd e2e && npx playwright test tests/public/charge-cards-login-redirect.spec.ts tests/shareholder/charge-cards.spec.ts
```

Expected: FAIL. The shareholder spec cannot find the `Laadpassen` link; the first public spec lands on `/nl/login` without a stored redirect; the second public spec ends on `/nl/dashboard`.

- [ ] **Step 2: Expose the feature flag in `/auth/me`**

In `apps/api/src/modules/auth/auth.service.ts`, `getProfile`:

1. In `coopAdminOf.include.coop.select`, add `chargeCardsEnabled: true,` after `trialEndsAt: true,`.
2. In `shareholders.include.coop.select` (the first `coop` select under `shareholders:`), add `chargeCardsEnabled: true,` after `minimumHoldingPeriod: true,`.
3. In the SYSTEM_ADMIN branch, change the select line `id: true, name: true, slug: true, active: true, plan: true, trialEndsAt: true,` to `id: true, name: true, slug: true, active: true, plan: true, trialEndsAt: true, chargeCardsEnabled: true,`.

`shareholderCoops` and `adminCoops` spread these coop objects, so both now carry `chargeCardsEnabled`.

Run: `pnpm --filter @opencoop/api build`
Expected: exit 0.

- [ ] **Step 3: Add the redirect helpers**

Create `apps/web/src/lib/post-login-redirect.ts`:

```ts
/**
 * Remembers where a logged-out visitor wanted to go, so the dashboard can send
 * them there after any login (password, passkey, magic link, OAuth). Stored in
 * localStorage because a magic link opens in a new tab.
 */
const KEY = 'opencoop-post-login-redirect';
const TTL_MS = 30 * 60 * 1000;
// Only dashboard paths, with an optional locale prefix. No hosts, no "//".
const SAFE_PATH = /^\/(?:(?:nl|en|fr|de)\/)?dashboard(?:\/[A-Za-z0-9_-]+)*\/?$/;

export function isSafeRedirectPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && SAFE_PATH.test(path);
}

export function rememberPostLoginRedirect(path: string | null | undefined): void {
  if (!isSafeRedirectPath(path)) return;
  localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
}

export function consumePostLoginRedirect(): string | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  localStorage.removeItem(KEY);
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof at === 'number' && Date.now() - at <= TTL_MS && isSafeRedirectPath(path as string)) {
      return path as string;
    }
  } catch {
    /* corrupt entry: ignore it, it is already removed */
  }
  return null;
}
```

Create `apps/web/src/lib/query-string.ts`:

```ts
/** Rebuilds a query string from Next.js searchParams, for server-side redirects. */
export function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.append(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}
```

- [ ] **Step 4: Wire the redirect into the dashboard and the login pages**

In `apps/web/src/app/[locale]/dashboard/layout.tsx`:

1. Add `Zap,` to the `lucide-react` import list (after `CalendarCheck,`).
2. Add `import { consumePostLoginRedirect, rememberPostLoginRedirect } from '@/lib/post-login-redirect';` after the `@/lib/sessions` import.
3. Change the `shareholderCoop` state to `useState<{ name: string; logoUrl?: string; chargeCardsEnabled?: boolean } | null>(null);`.
4. In the `api<{ ... }>('/auth/me')` type, change `shareholderCoops?: Array<{ name: string; logoUrl?: string }>;` to `shareholderCoops?: Array<{ name: string; logoUrl?: string; chargeCardsEnabled?: boolean }>;`.
5. Replace:

```ts
    if (!token || !userData) {
      router.push('/login');
      return;
    }
```

with:

```ts
    if (!token || !userData) {
      rememberPostLoginRedirect(pathname);
      router.push('/login');
      return;
    }

    // Back from a login that started on a deep link (e.g. bronsgroen.be → charge cards).
    const pendingRedirect = consumePostLoginRedirect();
    if (pendingRedirect && pendingRedirect !== pathname) {
      router.replace(pendingRedirect);
    }
```

6. In `shareholderNav`, after the `meetings` entry, add:

```tsx
    ...(shareholderCoop?.chargeCardsEnabled
      ? [{ href: '/dashboard/charge-cards', label: t('chargeCards.nav'), icon: <Zap className="h-4 w-4" /> }]
      : []),
```

Replace `apps/web/src/app/[locale]/(auth)/login/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';
import { rememberPostLoginRedirect } from '@/lib/post-login-redirect';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // ?redirect=/nl/dashboard/... survives the login; the dashboard layout consumes it.
    rememberPostLoginRedirect(searchParams.get('redirect'));
    const addAccount = searchParams.get('addAccount') === 'true';
    if (!addAccount && localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
    } else {
      setReady(true);
    }
  }, [router, searchParams]);

  if (!ready) return null;

  return <EmailFirstLogin />;
}
```

In `apps/web/src/components/auth/coop-login-content.tsx`:

1. Change the import to `import { notFound, useRouter, useSearchParams } from 'next/navigation';` and add `import { rememberPostLoginRedirect } from '@/lib/post-login-redirect';`.
2. Below `const router = useRouter();` add `const searchParams = useSearchParams();`.
3. Replace the first `useEffect` with:

```tsx
  useEffect(() => {
    // ?redirect=/nl/dashboard/... survives the login; the dashboard layout consumes it.
    rememberPostLoginRedirect(searchParams.get('redirect'));
    if (localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
      return;
    }
  }, [router, searchParams]);
```

Replace `apps/web/src/app/[locale]/[coopSlug]/login/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { toQueryString } from '@/lib/query-string';

export default async function CoopLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, coopSlug } = await params;
  // Keep ?redirect=... on the way to the default channel's login page.
  redirect(`/${locale}/${coopSlug}/default/login${toQueryString(await searchParams)}`);
}
```

Replace `apps/web/src/app/[locale]/[coopSlug]/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { toQueryString } from '@/lib/query-string';

export default async function CoopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, coopSlug } = await params;
  redirect(`/${locale}/${coopSlug}/login${toQueryString(await searchParams)}`);
}
```

These two server pages already `await params`, so awaiting `searchParams` follows the same Next.js 15 pattern; they are server components, not the client-side `use(params)` that `tasks/lessons.md` warns about.

- [ ] **Step 5: Add the `chargeCards` messages in four locales**

The script inserts the namespace as text before the final `}` of each file, so the duplicate keys elsewhere in `en.json` stay untouched. It refuses to run twice.

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
node - <<'JS'
const fs = require('fs');
const ns = {
  en: {
    nav: 'Charge cards', title: 'Charge cards',
    subtitle: 'Request a charging card for your electric car. You pay a one-time fee by bank transfer.',
    notEnabled: 'Charge cards are not available at your cooperative.',
    noShareholder: 'Charge cards are for shareholders. Log in with the account you used to buy shares.',
    notActive: 'Only active shareholders can request a charge card.',
    becomeShareholder: 'Become a shareholder',
    request: 'Request a card', requestTitle: 'Request a charge card',
    requestDescription: 'A card costs {fee} (incl. VAT), paid once by bank transfer.',
    label: 'Label (optional)', labelPlaceholder: 'e.g. Car Anna',
    replacementFor: 'Replacement for a lost card', noReplacement: 'No, this is an extra card',
    replacementDescription: 'A replacement card costs {fee} (incl. VAT).',
    submit: 'Send request',
    payTitle: 'Pay your charge card',
    payDescription: 'Transfer the amount with this structured communication.',
    beneficiary: 'Beneficiary', amount: 'Amount', ogm: 'Structured communication', close: 'Close',
    empty: 'You have no charge cards yet.', untitled: 'Charge card', cardNumber: 'Card number', fee: 'Fee',
    requestedOn: 'Requested on {date}', replacement: 'Replacement', showPayment: 'Payment details',
    cancel: 'Cancel request', cancelConfirm: 'Cancel this charge card request?',
    reportLost: 'Report lost',
    reportLostConfirm: 'Report this card as lost? It is blocked for good. You can then request a replacement.',
    reenable: 'My card does not work',
    reenableConfirm: 'We will ask the cooperative to re-activate your card. Continue?',
    reenableRequested: 'Re-activation requested. The cooperative will handle it.',
    actionError: 'That did not work. Please try again.',
    status: { REQUESTED: 'Requested', PAID: 'Paid', ACTIVE: 'Active', BLOCKED: 'Blocked', CANCELLED: 'Cancelled' },
    blockReason: { NO_SHARES: 'no active shares', LOST: 'lost', ADMIN: 'blocked by the cooperative' },
    admin: {
      title: 'Charge cards',
      subtitle: 'Requests, payments and issued cards. A card marked "To do in provider portal" needs the same change in the provider portal.',
      filterLabel: 'Show',
      filter: { ALL: 'All', REQUESTED: 'Requested', PAID: 'Paid', ACTIVE: 'Active', BLOCKED: 'Blocked', CANCELLED: 'Cancelled', TODO: 'To do in provider portal' },
      shareholder: 'Shareholder', label: 'Label', status: 'Status', ogm: 'Structured communication', fee: 'Fee', paid: 'Paid',
      cardNumber: 'Card number', waiting: 'Waiting', workingDays: '{days} working days', overdue: 'Overdue', actions: 'Actions',
      empty: 'No charge cards.', issue: 'Issue', issueTitle: 'Issue charge card',
      issueDescription: 'Enter the number printed on the card or its RFID UID. The card becomes active and the shareholder gets an email.',
      issueSubmit: 'Issue card', block: 'Block', unblock: 'Unblock', markLost: 'Mark lost', cancel: 'Cancel',
      syncDone: 'Done in portal', todo: 'To do in provider portal', confirm: 'Are you sure?',
    },
    settings: {
      title: 'Charge cards',
      description: 'Let shareholders request charging cards and pay a one-time fee by bank transfer.',
      enabled: 'Enable charge cards', fee: 'Card fee (incl. VAT)',
      replacementFee: 'Replacement fee after loss or theft (incl. VAT)', vatRate: 'VAT rate (%)',
    },
    match: { heading: 'Charge cards awaiting payment', card: 'Charge card' },
  },
  nl: {
    nav: 'Laadpassen', title: 'Laadpassen',
    subtitle: 'Vraag een laadpas voor je elektrische wagen aan. Je betaalt eenmalig per overschrijving.',
    notEnabled: 'Laadpassen zijn niet beschikbaar bij jouw coöperatie.',
    noShareholder: 'Laadpassen zijn voor aandeelhouders. Log in met het account waarmee je aandelen kocht.',
    notActive: 'Alleen actieve aandeelhouders kunnen een laadpas aanvragen.',
    becomeShareholder: 'Word aandeelhouder',
    request: 'Pas aanvragen', requestTitle: 'Laadpas aanvragen',
    requestDescription: 'Een pas kost {fee} (incl. btw), eenmalig te betalen per overschrijving.',
    label: 'Label (optioneel)', labelPlaceholder: 'bv. Auto Anna',
    replacementFor: 'Vervanging van een verloren pas', noReplacement: 'Nee, dit is een extra pas',
    replacementDescription: 'Een vervangpas kost {fee} (incl. btw).',
    submit: 'Aanvraag versturen',
    payTitle: 'Betaal je laadpas',
    payDescription: 'Schrijf het bedrag over met deze gestructureerde mededeling.',
    beneficiary: 'Begunstigde', amount: 'Bedrag', ogm: 'Gestructureerde mededeling', close: 'Sluiten',
    empty: 'Je hebt nog geen laadpassen.', untitled: 'Laadpas', cardNumber: 'Kaartnummer', fee: 'Prijs',
    requestedOn: 'Aangevraagd op {date}', replacement: 'Vervanging', showPayment: 'Betaalgegevens',
    cancel: 'Aanvraag annuleren', cancelConfirm: 'Deze aanvraag annuleren?',
    reportLost: 'Verlies melden',
    reportLostConfirm: 'Deze pas als verloren melden? Hij wordt definitief geblokkeerd. Daarna kun je een vervangpas aanvragen.',
    reenable: 'Mijn pas werkt niet',
    reenableConfirm: 'We vragen de coöperatie om je pas opnieuw te activeren. Doorgaan?',
    reenableRequested: 'Heractivering gevraagd. De coöperatie handelt het af.',
    actionError: 'Dat lukte niet. Probeer het opnieuw.',
    status: { REQUESTED: 'Aangevraagd', PAID: 'Betaald', ACTIVE: 'Actief', BLOCKED: 'Geblokkeerd', CANCELLED: 'Geannuleerd' },
    blockReason: { NO_SHARES: 'geen actieve aandelen', LOST: 'verloren', ADMIN: 'geblokkeerd door de coöperatie' },
    admin: {
      title: 'Laadpassen',
      subtitle: 'Aanvragen, betalingen en uitgegeven passen. Een pas met "Te doen in leveranciersportaal" vraagt dezelfde wijziging in het portaal van de leverancier.',
      filterLabel: 'Toon',
      filter: { ALL: 'Alle', REQUESTED: 'Aangevraagd', PAID: 'Betaald', ACTIVE: 'Actief', BLOCKED: 'Geblokkeerd', CANCELLED: 'Geannuleerd', TODO: 'Te doen in leveranciersportaal' },
      shareholder: 'Aandeelhouder', label: 'Label', status: 'Status', ogm: 'Gestructureerde mededeling', fee: 'Prijs', paid: 'Betaald',
      cardNumber: 'Kaartnummer', waiting: 'Wachttijd', workingDays: '{days} werkdagen', overdue: 'Te laat', actions: 'Acties',
      empty: 'Geen laadpassen.', issue: 'Uitgeven', issueTitle: 'Laadpas uitgeven',
      issueDescription: 'Vul het nummer op de pas of de RFID-UID in. De pas wordt actief en de aandeelhouder krijgt een e-mail.',
      issueSubmit: 'Pas uitgeven', block: 'Blokkeren', unblock: 'Deblokkeren', markLost: 'Verloren', cancel: 'Annuleren',
      syncDone: 'Gedaan in portaal', todo: 'Te doen in leveranciersportaal', confirm: 'Ben je zeker?',
    },
    settings: {
      title: 'Laadpassen',
      description: 'Laat aandeelhouders een laadpas aanvragen en eenmalig betalen per overschrijving.',
      enabled: 'Laadpassen inschakelen', fee: 'Prijs per pas (incl. btw)',
      replacementFee: 'Prijs vervangpas na verlies of diefstal (incl. btw)', vatRate: 'Btw-tarief (%)',
    },
    match: { heading: 'Laadpassen die wachten op betaling', card: 'Laadpas' },
  },
  fr: {
    nav: 'Cartes de recharge', title: 'Cartes de recharge',
    subtitle: 'Demandez une carte de recharge pour votre voiture électrique. Vous payez des frais uniques par virement.',
    notEnabled: 'Les cartes de recharge ne sont pas disponibles dans votre coopérative.',
    noShareholder: 'Les cartes de recharge sont réservées aux actionnaires. Connectez-vous avec le compte utilisé pour acheter vos parts.',
    notActive: 'Seuls les actionnaires actifs peuvent demander une carte de recharge.',
    becomeShareholder: 'Devenir actionnaire',
    request: 'Demander une carte', requestTitle: 'Demander une carte de recharge',
    requestDescription: 'Une carte coûte {fee} (TVA incl.), à payer une seule fois par virement.',
    label: 'Libellé (facultatif)', labelPlaceholder: 'p. ex. Voiture Anna',
    replacementFor: 'Remplacement d’une carte perdue', noReplacement: 'Non, c’est une carte supplémentaire',
    replacementDescription: 'Une carte de remplacement coûte {fee} (TVA incl.).',
    submit: 'Envoyer la demande',
    payTitle: 'Payez votre carte de recharge',
    payDescription: 'Virez le montant avec cette communication structurée.',
    beneficiary: 'Bénéficiaire', amount: 'Montant', ogm: 'Communication structurée', close: 'Fermer',
    empty: 'Vous n’avez pas encore de carte de recharge.', untitled: 'Carte de recharge', cardNumber: 'Numéro de carte', fee: 'Prix',
    requestedOn: 'Demandée le {date}', replacement: 'Remplacement', showPayment: 'Données de paiement',
    cancel: 'Annuler la demande', cancelConfirm: 'Annuler cette demande de carte ?',
    reportLost: 'Signaler une perte',
    reportLostConfirm: 'Signaler cette carte comme perdue ? Elle est bloquée définitivement. Vous pourrez ensuite demander une carte de remplacement.',
    reenable: 'Ma carte ne fonctionne pas',
    reenableConfirm: 'Nous demanderons à la coopérative de réactiver votre carte. Continuer ?',
    reenableRequested: 'Réactivation demandée. La coopérative s’en occupe.',
    actionError: 'Cela n’a pas fonctionné. Veuillez réessayer.',
    status: { REQUESTED: 'Demandée', PAID: 'Payée', ACTIVE: 'Active', BLOCKED: 'Bloquée', CANCELLED: 'Annulée' },
    blockReason: { NO_SHARES: 'plus de parts actives', LOST: 'perdue', ADMIN: 'bloquée par la coopérative' },
    admin: {
      title: 'Cartes de recharge',
      subtitle: 'Demandes, paiements et cartes délivrées. Une carte marquée « À faire dans le portail du fournisseur » demande la même modification dans ce portail.',
      filterLabel: 'Afficher',
      filter: { ALL: 'Toutes', REQUESTED: 'Demandées', PAID: 'Payées', ACTIVE: 'Actives', BLOCKED: 'Bloquées', CANCELLED: 'Annulées', TODO: 'À faire dans le portail du fournisseur' },
      shareholder: 'Actionnaire', label: 'Libellé', status: 'Statut', ogm: 'Communication structurée', fee: 'Prix', paid: 'Payé',
      cardNumber: 'Numéro de carte', waiting: 'Attente', workingDays: '{days} jours ouvrables', overdue: 'En retard', actions: 'Actions',
      empty: 'Aucune carte de recharge.', issue: 'Délivrer', issueTitle: 'Délivrer la carte de recharge',
      issueDescription: 'Saisissez le numéro imprimé sur la carte ou son UID RFID. La carte devient active et l’actionnaire reçoit un e-mail.',
      issueSubmit: 'Délivrer la carte', block: 'Bloquer', unblock: 'Débloquer', markLost: 'Perdue', cancel: 'Annuler',
      syncDone: 'Fait dans le portail', todo: 'À faire dans le portail du fournisseur', confirm: 'Êtes-vous sûr ?',
    },
    settings: {
      title: 'Cartes de recharge',
      description: 'Permettez aux actionnaires de demander une carte de recharge et de payer des frais uniques par virement.',
      enabled: 'Activer les cartes de recharge', fee: 'Prix par carte (TVA incl.)',
      replacementFee: 'Prix d’une carte de remplacement après perte ou vol (TVA incl.)', vatRate: 'Taux de TVA (%)',
    },
    match: { heading: 'Cartes de recharge en attente de paiement', card: 'Carte de recharge' },
  },
  de: {
    nav: 'Ladekarten', title: 'Ladekarten',
    subtitle: 'Beantragen Sie eine Ladekarte für Ihr Elektroauto. Sie zahlen eine einmalige Gebühr per Überweisung.',
    notEnabled: 'Ladekarten sind bei Ihrer Genossenschaft nicht verfügbar.',
    noShareholder: 'Ladekarten sind für Anteilseigner. Melden Sie sich mit dem Konto an, mit dem Sie Anteile gekauft haben.',
    notActive: 'Nur aktive Anteilseigner können eine Ladekarte beantragen.',
    becomeShareholder: 'Anteilseigner werden',
    request: 'Karte beantragen', requestTitle: 'Ladekarte beantragen',
    requestDescription: 'Eine Karte kostet {fee} (inkl. MwSt.), einmalig per Überweisung.',
    label: 'Bezeichnung (optional)', labelPlaceholder: 'z. B. Auto Anna',
    replacementFor: 'Ersatz für eine verlorene Karte', noReplacement: 'Nein, das ist eine zusätzliche Karte',
    replacementDescription: 'Eine Ersatzkarte kostet {fee} (inkl. MwSt.).',
    submit: 'Antrag senden',
    payTitle: 'Ladekarte bezahlen',
    payDescription: 'Überweisen Sie den Betrag mit dieser strukturierten Mitteilung.',
    beneficiary: 'Empfänger', amount: 'Betrag', ogm: 'Strukturierte Mitteilung', close: 'Schließen',
    empty: 'Sie haben noch keine Ladekarten.', untitled: 'Ladekarte', cardNumber: 'Kartennummer', fee: 'Preis',
    requestedOn: 'Beantragt am {date}', replacement: 'Ersatz', showPayment: 'Zahlungsdaten',
    cancel: 'Antrag stornieren', cancelConfirm: 'Diesen Antrag stornieren?',
    reportLost: 'Verlust melden',
    reportLostConfirm: 'Diese Karte als verloren melden? Sie wird endgültig gesperrt. Danach können Sie eine Ersatzkarte beantragen.',
    reenable: 'Meine Karte funktioniert nicht',
    reenableConfirm: 'Wir bitten die Genossenschaft, Ihre Karte wieder zu aktivieren. Fortfahren?',
    reenableRequested: 'Reaktivierung angefragt. Die Genossenschaft kümmert sich darum.',
    actionError: 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.',
    status: { REQUESTED: 'Beantragt', PAID: 'Bezahlt', ACTIVE: 'Aktiv', BLOCKED: 'Gesperrt', CANCELLED: 'Storniert' },
    blockReason: { NO_SHARES: 'keine aktiven Anteile', LOST: 'verloren', ADMIN: 'von der Genossenschaft gesperrt' },
    admin: {
      title: 'Ladekarten',
      subtitle: 'Anträge, Zahlungen und ausgegebene Karten. Eine Karte mit „Im Anbieterportal zu erledigen“ braucht dieselbe Änderung im Portal des Anbieters.',
      filterLabel: 'Anzeigen',
      filter: { ALL: 'Alle', REQUESTED: 'Beantragt', PAID: 'Bezahlt', ACTIVE: 'Aktiv', BLOCKED: 'Gesperrt', CANCELLED: 'Storniert', TODO: 'Im Anbieterportal zu erledigen' },
      shareholder: 'Anteilseigner', label: 'Bezeichnung', status: 'Status', ogm: 'Strukturierte Mitteilung', fee: 'Preis', paid: 'Bezahlt',
      cardNumber: 'Kartennummer', waiting: 'Wartezeit', workingDays: '{days} Werktage', overdue: 'Überfällig', actions: 'Aktionen',
      empty: 'Keine Ladekarten.', issue: 'Ausgeben', issueTitle: 'Ladekarte ausgeben',
      issueDescription: 'Geben Sie die aufgedruckte Kartennummer oder die RFID-UID ein. Die Karte wird aktiv und der Anteilseigner erhält eine E-Mail.',
      issueSubmit: 'Karte ausgeben', block: 'Sperren', unblock: 'Entsperren', markLost: 'Verloren', cancel: 'Stornieren',
      syncDone: 'Im Portal erledigt', todo: 'Im Anbieterportal zu erledigen', confirm: 'Sind Sie sicher?',
    },
    settings: {
      title: 'Ladekarten',
      description: 'Anteilseigner können eine Ladekarte beantragen und eine einmalige Gebühr per Überweisung zahlen.',
      enabled: 'Ladekarten aktivieren', fee: 'Preis pro Karte (inkl. MwSt.)',
      replacementFee: 'Preis einer Ersatzkarte nach Verlust oder Diebstahl (inkl. MwSt.)', vatRate: 'MwSt.-Satz (%)',
    },
    match: { heading: 'Ladekarten, die auf Zahlung warten', card: 'Ladekarte' },
  },
};
for (const [lang, block] of Object.entries(ns)) {
  const file = `apps/web/messages/${lang}.json`;
  const text = fs.readFileSync(file, 'utf8');
  if (/^  "chargeCards"\s*:/m.test(text)) throw new Error(`${file} already has a chargeCards namespace`);
  const body = JSON.stringify(block, null, 2).replace(/\n/g, '\n  ');
  const next = text.replace(/\n}\s*$/, `,\n  "chargeCards": ${body}\n}\n`);
  if (next === text) throw new Error(`${file}: closing brace not found`);
  JSON.parse(next);
  fs.writeFileSync(file, next);
}
console.log('ok');
JS
git diff --stat apps/web/messages
```

Expected: `ok`, and `git diff --stat` shows only insertions (about 95 lines per file, 0 deletions apart from the changed last line).

- [ ] **Step 6: Build the shareholder page**

Create `apps/web/src/app/[locale]/dashboard/charge-cards/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EpcQrCode } from '@/components/epc-qr-code';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { Loader2, Plus } from 'lucide-react';

type CardStatus = 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
type BlockReason = 'NO_SHARES' | 'LOST' | 'ADMIN';
type CardAction = 'cancel' | 'report-lost' | 'request-reenable';

interface ChargeCardView {
  id: string;
  label: string | null;
  status: CardStatus;
  blockReason: BlockReason | null;
  ogmCode: string;
  cardNumber: string | null;
  feeInclVat: number;
  isReplacement: boolean;
  replaced: boolean;
  providerSyncNeeded: boolean;
  requestedAt: string;
}

interface Overview {
  enabled: boolean;
  coop: { name: string; slug: string; bankIban: string | null; bankBic: string | null };
  shareholderStatus: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  fee: number;
  replacementFee: number;
  cards: ChargeCardView[];
}

interface PaymentDetails {
  beneficiaryName: string;
  iban: string | null;
  bic: string | null;
  amount: number;
  ogmCode: string;
}

const NEW_CARD = 'new';

export default function ChargeCardsPage() {
  const t = useTranslations('chargeCards');
  const { locale } = useLocale();
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [replaces, setReplaces] = useState(NEW_CARD);
  const [submitting, setSubmitting] = useState(false);
  const [payment, setPayment] = useState<PaymentDetails | null>(null);

  const load = useCallback(async (id: string) => {
    setOverview(await api<Overview>(`/shareholders/${id}/charge-cards`));
  }, []);

  useEffect(() => {
    api<{ shareholders?: Array<{ id: string }> }>('/auth/me')
      .then(async (profile) => {
        // Same convention as the other dashboard pages: the first shareholder record.
        const id = profile.shareholders?.[0]?.id ?? null;
        setShareholderId(id);
        if (id) await load(id);
      })
      .catch(() => setError(t('actionError')))
      .finally(() => setLoading(false));
  }, [load, t]);

  const paymentFor = (card: ChargeCardView): PaymentDetails | null =>
    overview
      ? {
          beneficiaryName: overview.coop.name,
          iban: overview.coop.bankIban,
          bic: overview.coop.bankBic,
          amount: card.feeInclVat,
          ogmCode: card.ogmCode,
        }
      : null;

  const runAction = async (cardId: string, action: CardAction, confirmText: string) => {
    if (!shareholderId || !window.confirm(confirmText)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/shareholders/${shareholderId}/charge-cards/${cardId}/${action}`, { method: 'POST' });
      if (action === 'request-reenable') setNotice(t('reenableRequested'));
      await load(shareholderId);
    } catch {
      setError(t('actionError'));
    }
  };

  const submitRequest = async () => {
    if (!shareholderId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ payment: PaymentDetails }>(`/shareholders/${shareholderId}/charge-cards`, {
        method: 'POST',
        body: { label: label.trim() || undefined, replacesCardId: replaces === NEW_CARD ? undefined : replaces },
      });
      setRequestOpen(false);
      setLabel('');
      setReplaces(NEW_CARD);
      setPayment(result.payment);
      await load(shareholderId);
    } catch {
      setError(t('actionError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!shareholderId || !overview) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{error ?? t('noShareholder')}</CardContent>
      </Card>
    );
  }

  if (!overview.enabled) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">{t('notEnabled')}</CardContent>
      </Card>
    );
  }

  const isActive = overview.shareholderStatus === 'ACTIVE';
  const lostCards = overview.cards.filter((c) => c.status === 'BLOCKED' && c.blockReason === 'LOST' && !c.replaced);
  const fee = formatCurrency(replaces === NEW_CARD ? overview.fee : overview.replacementFee, locale);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setRequestOpen(true)} disabled={!isActive}>
          <Plus className="h-4 w-4 mr-2" />
          {t('request')}
        </Button>
      </div>

      {!isActive && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('notActive')}</span>
            <Link href={`/${overview.coop.slug}/register`} className="font-medium underline">
              {t('becomeShareholder')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {overview.cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {overview.cards.map((card) => (
            <Card key={card.id} data-testid="charge-card">
              <CardContent className="pt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{card.label || t('untitled')}</h2>
                    <Badge
                      variant={card.status === 'ACTIVE' ? 'default' : card.status === 'BLOCKED' ? 'destructive' : 'secondary'}
                    >
                      {t(`status.${card.status}`)}
                      {card.blockReason ? ` · ${t(`blockReason.${card.blockReason}`)}` : ''}
                    </Badge>
                    {card.isReplacement && <Badge variant="outline">{t('replacement')}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('requestedOn', { date: new Date(card.requestedAt).toLocaleDateString(locale) })} · {t('fee')}:{' '}
                    {formatCurrency(card.feeInclVat, locale)}
                  </p>
                  {card.cardNumber && (
                    <p className="text-sm">
                      {t('cardNumber')}: <span className="font-mono">{card.cardNumber}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {card.status === 'REQUESTED' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setPayment(paymentFor(card))}>
                        {t('showPayment')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => runAction(card.id, 'cancel', t('cancelConfirm'))}>
                        {t('cancel')}
                      </Button>
                    </>
                  )}
                  {card.status === 'ACTIVE' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={card.providerSyncNeeded}
                      onClick={() => runAction(card.id, 'request-reenable', t('reenableConfirm'))}
                    >
                      {t('reenable')}
                    </Button>
                  )}
                  {(card.status === 'ACTIVE' || (card.status === 'BLOCKED' && card.blockReason !== 'LOST')) && (
                    <Button variant="ghost" size="sm" onClick={() => runAction(card.id, 'report-lost', t('reportLostConfirm'))}>
                      {t('reportLost')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('requestTitle')}</DialogTitle>
            <DialogDescription>
              {replaces === NEW_CARD ? t('requestDescription', { fee }) : t('replacementDescription', { fee })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="charge-card-label">{t('label')}</Label>
              <Input
                id="charge-card-label"
                maxLength={60}
                value={label}
                placeholder={t('labelPlaceholder')}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            {lostCards.length > 0 && (
              <div className="space-y-2">
                <Label>{t('replacementFor')}</Label>
                <Select value={replaces} onValueChange={setReplaces}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_CARD}>{t('noReplacement')}</SelectItem>
                    {lostCards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label || t('untitled')} · {c.cardNumber ?? c.ogmCode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={submitRequest} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payment !== null} onOpenChange={(open) => !open && setPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payTitle')}</DialogTitle>
            <DialogDescription>{t('payDescription')}</DialogDescription>
          </DialogHeader>
          {payment && (
            <div className="space-y-4">
              {payment.iban && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={payment.bic ?? undefined}
                    beneficiaryName={payment.beneficiaryName}
                    iban={payment.iban}
                    amount={payment.amount}
                    reference={payment.ogmCode}
                    label={t('payTitle')}
                  />
                </div>
              )}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('beneficiary')}</dt>
                  <dd className="font-medium">{payment.beneficiaryName}</dd>
                </div>
                {payment.iban && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">IBAN</dt>
                    <dd className="font-mono text-xs">{formatIban(payment.iban)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('amount')}</dt>
                  <dd className="font-medium">{formatCurrency(payment.amount, locale)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t('ogm')}</dt>
                  <dd className="font-mono text-xs" data-testid="charge-card-ogm">
                    {payment.ogmCode}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayment(null)}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 7: Run the e2e specs and watch them pass**

Restart the API so it serves the new `/auth/me` fields (Playwright starts it if nothing runs on port 3001), then:

```bash
cd e2e && npx playwright test tests/public/charge-cards-login-redirect.spec.ts tests/shareholder/charge-cards.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Build, lint, commit**

```bash
pnpm --filter @opencoop/api build
pnpm --filter @opencoop/web build
pnpm --filter @opencoop/web exec next lint
```

Expected: both builds exit 0; `next lint` reports no errors.

```bash
git add apps/api/src/modules/auth/auth.service.ts \
  apps/web/src/lib/post-login-redirect.ts apps/web/src/lib/query-string.ts \
  "apps/web/src/app/[locale]/dashboard/layout.tsx" \
  "apps/web/src/app/[locale]/(auth)/login/page.tsx" \
  apps/web/src/components/auth/coop-login-content.tsx \
  "apps/web/src/app/[locale]/[coopSlug]/login/page.tsx" "apps/web/src/app/[locale]/[coopSlug]/page.tsx" \
  "apps/web/src/app/[locale]/dashboard/charge-cards/page.tsx" \
  apps/web/messages/en.json apps/web/messages/nl.json apps/web/messages/fr.json apps/web/messages/de.json \
  e2e/helpers/charge-cards.ts e2e/tests/shareholder/charge-cards.spec.ts \
  e2e/tests/public/charge-cards-login-redirect.spec.ts
git commit -m "feat(web): shareholder charge-cards page; login returns to the requested page"
```

---

### Task 9: Web — admin charge-cards page, settings, and manual match to a card

**Files:**
- Modify: `apps/web/src/contexts/admin-context.tsx` (`AdminCoop`)
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx` (`adminNav`)
- Create: `apps/web/src/app/[locale]/dashboard/admin/charge-cards/page.tsx`
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx` (form state, load, save, a new card before "Ecopower Integration")
- Modify: `apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx` (match dialog)
- Create: `e2e/tests/admin/charge-cards.spec.ts`
- Modify: `e2e/tests/admin/settings.spec.ts`

**Interfaces:**
- Consumes: admin endpoints (Task 6), `POST /admin/coops/:coopId/bank-transactions/:id/match { chargeCardId }` (Task 5), settings fields (Task 4), `adminCoops[].chargeCardsEnabled` (Task 8), `chargeCards.*` messages (Task 8), e2e helpers (Task 8).
- Produces: route `/[locale]/dashboard/admin/charge-cards`.

- [ ] **Step 1: Write the failing e2e specs**

Create `e2e/tests/admin/charge-cards.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { API_URL, apiAs, enableChargeCards, tokenFor } from '../../helpers/charge-cards';

test.describe('Admin charge cards', () => {
  let label: string;

  test.beforeAll(async () => {
    const coopId = await enableChargeCards();
    label = `E2E paid ${Date.now()}`;

    const me = await apiAs<{ shareholders: Array<{ id: string }> }>('shareholder', 'GET', '/auth/me');
    const { card } = await apiAs<{ card: { ogmCode: string; feeInclVat: number } }>(
      'shareholder',
      'POST',
      `/shareholders/${me.shareholders[0].id}/charge-cards`,
      { label },
    );

    // Pay the card the way a coop does: a bank CSV import with the card's OGM.
    const csv = `date;amount;counterparty;reference\n2026-10-06;${card.feeInclVat.toFixed(2)};Jan Peeters;${card.ogmCode}\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'charge-card.csv');
    const res = await fetch(`${API_URL}/admin/coops/${coopId}/bank-import?preset=generic`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenFor('admin')}` },
      body: form,
    });
    expect(res.ok).toBe(true);
  });

  test('issues a paid card, blocks it, and clears the provider to-do', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/nl/dashboard/admin/charge-cards');
    await expect(page.locator('main').getByRole('heading', { name: 'Laadpassen' })).toBeVisible({ timeout: 10_000 });

    const row = page.getByRole('row').filter({ hasText: label });
    await expect(row.getByText('Betaald', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Uitgeven', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kaartnummer').fill(`  E2E-${Date.now()}  `);
    await dialog.getByRole('button', { name: 'Pas uitgeven' }).click();
    await expect(row.getByText('Actief', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Blokkeren', exact: true }).click();
    await expect(row.getByText('Te doen in leveranciersportaal', { exact: true })).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Te doen in leveranciersportaal' }).click();
    const todoRow = page.getByRole('row').filter({ hasText: label });
    await expect(todoRow).toBeVisible();
    await todoRow.getByRole('button', { name: 'Gedaan in portaal' }).click();
    await expect(todoRow).toHaveCount(0);
  });
});
```

Append to `e2e/tests/admin/settings.spec.ts`, inside the `describe`, and add `import { enableChargeCards } from '../../helpers/charge-cards';` at the top:

```ts
  test('shows the charge-card settings when the feature is on', async ({ page }) => {
    await enableChargeCards();

    await page.goto('/nl/dashboard/admin/settings');

    await expect(page.getByRole('heading', { name: 'Laadpassen', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Laadpassen inschakelen')).toBeChecked();
    await expect(page.getByLabel('Prijs per pas (incl. btw)')).toHaveValue('6.00');
    await expect(page.getByLabel('Prijs vervangpas na verlies of diefstal (incl. btw)')).toHaveValue('12.00');
    await expect(page.getByLabel('Btw-tarief (%)')).toHaveValue('21');
  });
```

Run: `cd e2e && npx playwright test tests/admin/charge-cards.spec.ts tests/admin/settings.spec.ts`
Expected: FAIL — `/nl/dashboard/admin/charge-cards` renders a 404, and the settings page has no "Laadpassen" heading.

- [ ] **Step 2: Add the admin nav entry**

In `apps/web/src/contexts/admin-context.tsx`, add `chargeCardsEnabled?: boolean;` to `interface AdminCoop` after `logoUrl?: string;`.

In `apps/web/src/app/[locale]/dashboard/layout.tsx`, in `adminNav`, after the `canManageShareholders` shareholders entry, add:

```tsx
        hasPermission('canManageShareholders') && selectedCoop.chargeCardsEnabled && { href: '/dashboard/admin/charge-cards', label: t('chargeCards.admin.title'), icon: <Zap className="h-4 w-4" /> },
```

The flag comes from `/auth/me` at page load. After an admin switches the feature on in settings, the nav entry shows from the next page load.

- [ ] **Step 3: Build the admin page**

Create `apps/web/src/app/[locale]/dashboard/admin/charge-cards/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@opencoop/shared';
import { Loader2 } from 'lucide-react';

type CardStatus = 'REQUESTED' | 'PAID' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
type Filter = 'ALL' | CardStatus | 'TODO';
type AdminAction = 'block' | 'unblock' | 'mark-lost' | 'provider-sync-done' | 'cancel';

const FILTERS: Filter[] = ['ALL', 'REQUESTED', 'PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED', 'TODO'];

interface AdminChargeCard {
  id: string;
  label: string | null;
  status: CardStatus;
  blockReason: 'NO_SHARES' | 'LOST' | 'ADMIN' | null;
  ogmCode: string;
  cardNumber: string | null;
  feeInclVat: number;
  isReplacement: boolean;
  providerSyncNeeded: boolean;
  shareholderName: string;
  totalPaid: number;
  waitingWorkingDays: number | null;
  overdue: boolean;
}

function queryFor(filter: Filter): string {
  if (filter === 'ALL') return '';
  if (filter === 'TODO') return '?todo=true';
  return `?status=${filter}`;
}

export default function AdminChargeCardsPage() {
  const t = useTranslations('chargeCards');
  const { locale } = useLocale();
  const { selectedCoop } = useAdmin();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [cards, setCards] = useState<AdminChargeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState<AdminChargeCard | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      setCards(await api<AdminChargeCard[]>(`/admin/coops/${selectedCoop.id}/charge-cards${queryFor(filter)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, filter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (card: AdminChargeCard, action: AdminAction) => {
    if (!selectedCoop || !window.confirm(t('admin.confirm'))) return;
    setBusy(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/charge-cards/${card.id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setBusy(false);
    }
  };

  const submitIssue = async () => {
    if (!selectedCoop || !issuing) return;
    setBusy(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/charge-cards/${issuing.id}/issue`, {
        method: 'POST',
        body: { cardNumber },
      });
      setIssuing(null);
      setCardNumber('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.subtitle')}</p>
        </div>
        <div className="w-64 space-y-1">
          <Label>{t('admin.filterLabel')}</Label>
          <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`admin.filter.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : cards.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t('admin.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.shareholder')}</TableHead>
                  <TableHead>{t('admin.label')}</TableHead>
                  <TableHead>{t('admin.status')}</TableHead>
                  <TableHead>{t('admin.ogm')}</TableHead>
                  <TableHead className="text-right">{t('admin.fee')}</TableHead>
                  <TableHead className="text-right">{t('admin.paid')}</TableHead>
                  <TableHead>{t('admin.cardNumber')}</TableHead>
                  <TableHead>{t('admin.waiting')}</TableHead>
                  <TableHead>{t('admin.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cards.map((card) => (
                  <TableRow key={card.id} className={card.overdue ? 'bg-red-50 dark:bg-red-950/30' : undefined}>
                    <TableCell className="font-medium">{card.shareholderName}</TableCell>
                    <TableCell>
                      {card.label || '—'}
                      {card.isReplacement && (
                        <Badge variant="outline" className="ml-2">
                          {t('replacement')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={card.status === 'BLOCKED' ? 'destructive' : card.status === 'ACTIVE' ? 'default' : 'secondary'}
                        >
                          {t(`status.${card.status}`)}
                          {card.blockReason ? ` · ${t(`blockReason.${card.blockReason}`)}` : ''}
                        </Badge>
                        {card.providerSyncNeeded && <Badge variant="outline">{t('admin.todo')}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{card.ogmCode}</TableCell>
                    <TableCell className="text-right">{formatCurrency(card.feeInclVat, locale)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(card.totalPaid, locale)}</TableCell>
                    <TableCell className="font-mono text-xs">{card.cardNumber ?? '—'}</TableCell>
                    <TableCell>
                      {card.waitingWorkingDays === null ? (
                        '—'
                      ) : (
                        <span className={card.overdue ? 'font-medium text-red-700 dark:text-red-400' : undefined}>
                          {t('admin.workingDays', { days: card.waitingWorkingDays })}
                          {card.overdue ? ` · ${t('admin.overdue')}` : ''}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {card.status === 'PAID' && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setIssuing(card);
                              setCardNumber('');
                            }}
                          >
                            {t('admin.issue')}
                          </Button>
                        )}
                        {card.status === 'ACTIVE' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(card, 'block')}>
                            {t('admin.block')}
                          </Button>
                        )}
                        {card.status === 'BLOCKED' && card.blockReason === 'ADMIN' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(card, 'unblock')}>
                            {t('admin.unblock')}
                          </Button>
                        )}
                        {(card.status === 'ACTIVE' || (card.status === 'BLOCKED' && card.blockReason !== 'LOST')) && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(card, 'mark-lost')}>
                            {t('admin.markLost')}
                          </Button>
                        )}
                        {(card.status === 'REQUESTED' || card.status === 'PAID') && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(card, 'cancel')}>
                            {t('admin.cancel')}
                          </Button>
                        )}
                        {card.providerSyncNeeded && (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(card, 'provider-sync-done')}>
                            {t('admin.syncDone')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={issuing !== null} onOpenChange={(open) => !open && setIssuing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.issueTitle')}</DialogTitle>
            <DialogDescription>{t('admin.issueDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="charge-card-number">{t('admin.cardNumber')}</Label>
            <Input
              id="charge-card-number"
              maxLength={64}
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={submitIssue} disabled={busy || cardNumber.trim() === ''}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('admin.issueSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Add the settings section**

In `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`:

1. Add a module-level helper directly above `export default function`:

```ts
function toOptionalNumber(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
```

2. In the form-state interface, after `ecoPowerMinThreshold: string;`, add:

```ts
  chargeCardsEnabled: boolean;
  chargeCardFee: string;
  chargeCardReplacementFee: string;
  chargeCardVatRate: string;
```

3. In `interface SettingsResponse`, after `ecoPowerMinThreshold: number | null;`, add (Prisma serialises `Decimal` as a string):

```ts
  chargeCardsEnabled: boolean;
  chargeCardFee: string | null;
  chargeCardReplacementFee: string | null;
  chargeCardVatRate: string | null;
```

4. In the initial form state, after `ecoPowerMinThreshold: '',`, add:

```ts
    chargeCardsEnabled: false,
    chargeCardFee: '6.00',
    chargeCardReplacementFee: '12.00',
    chargeCardVatRate: '21',
```

5. In the load mapping, after `ecoPowerMinThreshold: settings.ecoPowerMinThreshold?.toString() || '',`, add:

```ts
          chargeCardsEnabled: settings.chargeCardsEnabled || false,
          chargeCardFee: settings.chargeCardFee != null ? Number(settings.chargeCardFee).toFixed(2) : '6.00',
          chargeCardReplacementFee:
            settings.chargeCardReplacementFee != null ? Number(settings.chargeCardReplacementFee).toFixed(2) : '12.00',
          chargeCardVatRate: settings.chargeCardVatRate != null ? String(Number(settings.chargeCardVatRate)) : '21',
```

6. In `handleSave`'s `body`, after the `ecoPowerMinThreshold:` line, add:

```ts
        chargeCardsEnabled: form.chargeCardsEnabled,
        chargeCardFee: toOptionalNumber(form.chargeCardFee),
        chargeCardReplacementFee: toOptionalNumber(form.chargeCardReplacementFee),
        chargeCardVatRate: toOptionalNumber(form.chargeCardVatRate),
```

7. Directly above the line `{/* Ecopower Integration */}`, add:

```tsx
        {/* Charge cards */}
        <Card>
          <CardHeader>
            <CardTitle>{t('chargeCards.settings.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('chargeCards.settings.description')}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="charge-cards-enabled"
                checked={form.chargeCardsEnabled}
                onCheckedChange={(c) => setForm({ ...form, chargeCardsEnabled: !!c })}
              />
              <Label htmlFor="charge-cards-enabled">{t('chargeCards.settings.enabled')}</Label>
            </div>
            {form.chargeCardsEnabled && (
              <div className="grid gap-4 pl-6 border-l-2 border-muted sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="charge-card-fee">{t('chargeCards.settings.fee')}</Label>
                  <Input
                    id="charge-card-fee"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.chargeCardFee}
                    onChange={(e) => setForm({ ...form, chargeCardFee: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="charge-card-replacement-fee">{t('chargeCards.settings.replacementFee')}</Label>
                  <Input
                    id="charge-card-replacement-fee"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.chargeCardReplacementFee}
                    onChange={(e) => setForm({ ...form, chargeCardReplacementFee: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="charge-card-vat-rate">{t('chargeCards.settings.vatRate')}</Label>
                  <Input
                    id="charge-card-vat-rate"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.chargeCardVatRate}
                    onChange={(e) => setForm({ ...form, chargeCardVatRate: e.target.value })}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

```

- [ ] **Step 5: Let the bank-import match dialog book on a card**

Main (v2026.39.4) moved manual matching for every bank row, CSV and Ponto, to the dialog on `admin/bank-import/page.tsx`. A short card payment from a CSV import lands there, so the card list goes into that dialog. (The older dialog on `admin/transactions/page.tsx` lists Ponto rows only; leave it as it is.)

In `apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx`:

1. Add near the other interfaces (after `interface UnlinkedPayment { ... }`):

```ts
interface MatchableChargeCard {
  id: string;
  label: string | null;
  ogmCode: string;
  feeInclVat: number;
  totalPaid: number;
  shareholderName: string;
}
```

2. Below `const [registrations, setRegistrations] = useState<Registration[]>([]);`, add `const [matchCards, setMatchCards] = useState<MatchableChargeCard[]>([]);`.
3. In `openMatchDialog`, directly after the closing `}` of its `try { ... } catch { ... } finally { ... }` block, add:

```ts
    // Cards need canManageShareholders; an admin without it simply sees none.
    setMatchCards(
      selectedCoop?.chargeCardsEnabled
        ? await api<MatchableChargeCard[]>(`/admin/coops/${selectedCoop.id}/charge-cards?status=REQUESTED`).catch(
            () => [],
          )
        : [],
    );
```

4. Change the `handleMatch` signature from `async (target: { registrationId?: string; paymentId?: string })` to `async (target: { registrationId?: string; paymentId?: string; chargeCardId?: string })`. Its body already posts `target` as is.
5. In the match dialog, directly after the closing `</div>` of the section headed `{t('admin.bankImport.openRegistration')}` (still inside the dialog's outer wrapper `<div>`), add:

```tsx
              {matchCards.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">{t('chargeCards.match.heading')}</h4>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {matchCards.map((card) => (
                      <button
                        key={card.id}
                        className="w-full flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                        onClick={() => handleMatch({ chargeCardId: card.id })}
                        disabled={matching}
                      >
                        <div className="text-left">
                          <p className="font-medium">{card.shareholderName}</p>
                          <p className="text-muted-foreground text-xs">
                            {t('chargeCards.match.card')}
                            {card.label ? ` · ${card.label}` : ''}
                          </p>
                          <p className="text-muted-foreground font-mono text-xs">{card.ogmCode}</p>
                        </div>
                        <div className="text-right">
                          <p>{formatCurrency(card.feeInclVat, locale)}</p>
                          {card.totalPaid > 0 && (
                            <p className="text-muted-foreground text-xs">
                              {t('chargeCards.admin.paid')}: {formatCurrency(card.totalPaid, locale)}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
```

The admin e2e from Step 1 pays a card in full through a CSV import, so it never opens this dialog. A short CSV payment for a card shows up as UNMATCHED on this page: check the dialog by hand once on acc. The API path is covered by the Task 5 unit tests.

- [ ] **Step 6: Run the e2e specs and watch them pass**

Run: `cd e2e && npx playwright test tests/admin/charge-cards.spec.ts tests/admin/settings.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Build, lint, commit**

```bash
pnpm --filter @opencoop/web build
pnpm --filter @opencoop/web exec next lint
```

Expected: build exits 0; lint reports no errors.

```bash
git add apps/web/src/contexts/admin-context.tsx "apps/web/src/app/[locale]/dashboard/layout.tsx" \
  "apps/web/src/app/[locale]/dashboard/admin/charge-cards/page.tsx" \
  "apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx" \
  "apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx" \
  e2e/tests/admin/charge-cards.spec.ts e2e/tests/admin/settings.spec.ts
git commit -m "feat(web): admin charge-cards page, settings, and manual match to a card"
```

---

### Task 10: Locale parity, full verification, changelog

The user's task list puts i18n last. The strings and emails already landed with the code that uses them (Tasks 4, 6, 8), because each task's tests render them. This task proves the four locales match and runs every check once more on the whole branch.

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a verified branch.

- [ ] **Step 1: Check locale parity and key usage**

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
node - <<'JS'
const fs = require('fs');
const flatten = (obj, prefix = '') =>
  Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const langs = ['en', 'nl', 'fr', 'de'];
let ok = true;
const fail = (msg) => { console.error(msg); ok = false; };

const web = Object.fromEntries(langs.map((l) => [l, flatten(JSON.parse(fs.readFileSync(`apps/web/messages/${l}.json`, 'utf8')).chargeCards).sort()]));
const mail = Object.fromEntries(langs.map((l) => {
  const j = JSON.parse(fs.readFileSync(`apps/api/src/modules/email/i18n/${l}.json`, 'utf8'));
  return [l, flatten({ notice: j['charge-card-coop-notice'], issued: j['charge-card-issued'] }).sort()];
}));
for (const l of langs.slice(1)) {
  if (web[l].join() !== web.en.join()) fail(`web ${l}: chargeCards keys differ from en`);
  if (mail[l].join() !== mail.en.join()) fail(`email ${l}: charge-card keys differ from en`);
}

const known = new Set(web.en.map((k) => `chargeCards.${k}`));
const pages = [
  ['apps/web/src/app/[locale]/dashboard/charge-cards/page.tsx', 'chargeCards.'],
  ['apps/web/src/app/[locale]/dashboard/admin/charge-cards/page.tsx', 'chargeCards.'],
];
for (const [file, prefix] of pages) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\('([^']+)'/g)) {
    if (!known.has(prefix + m[1])) fail(`${file}: unknown key ${prefix}${m[1]}`);
  }
}
for (const file of [
  'apps/web/src/app/[locale]/dashboard/layout.tsx',
  'apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx',
  'apps/web/src/app/[locale]/dashboard/admin/bank-import/page.tsx',
]) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\('(chargeCards\.[^']+)'/g)) {
    if (!known.has(m[1])) fail(`${file}: unknown key ${m[1]}`);
  }
}
if (!ok) process.exit(1);
console.log(`ok: ${web.en.length} web keys and ${mail.en.length} email keys in ${langs.length} locales`);
JS
echo "exit=$?"
```

Expected: `ok: 86 web keys and 18 email keys in 4 locales` and `exit=0`. Template-literal keys (`` t(`status.${…}`) ``) are not scanned; the `status`, `blockReason` and `admin.filter` objects cover every enum value by construction.

- [ ] **Step 2: Run every check on the branch**

```bash
cd /Users/wouterhermans/Developer/opencoop-worktrees/charge-cards
pnpm --filter "@opencoop/api^..." build
pnpm --filter @opencoop/api lint
pnpm --filter @opencoop/api test
docker compose -f docker-compose.test.yml up -d --force-recreate --wait postgres-test
docker compose -f docker-compose.test.yml exec -T postgres-test createdb -U opencoop opencoop_shadow
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec prisma db push --skip-generate --accept-data-loss
TEST_DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/api exec jest --runInBand db.spec
pnpm build
pnpm --filter @opencoop/web exec next lint
pnpm test:e2e:setup
DATABASE_URL=postgresql://opencoop:opencoop@localhost:5433/opencoop_test pnpm --filter @opencoop/database exec tsx prisma/seed-demo.ts
cd e2e && npx playwright test; echo "e2e exit=$?"
```

Expected: unit suites all pass (DB specs skipped); 7 DB tests pass; `pnpm build` exits 0; the full Playwright run passes, `e2e exit=0`. Run each line on its own if one fails, so its exit status is not hidden.

Then check the migration diff one last time (Task 1 Step 11 command). Expected: `exit=0`.

- [ ] **Step 3: Add the changelog entry**

Insert directly above the first `## [` release heading in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- **Charge cards (laadpassen).** A coop can turn on charge cards in Settings and set the card fee and the replacement fee (incl. VAT). Active shareholders request a card in the dashboard, see the IBAN, amount and OGM, and pay by bank transfer. A CSV import, Ponto or a rematch matches the payment and marks the card paid; an admin can also match a bank row to a card by hand on the bank-import page. Admins issue the card with its number, block and unblock it, and see how many working days each open card has waited; cards older than 5 working days are highlighted. Cards block themselves when the shareholder no longer holds shares and unblock when they do again. Each block or unblock shows up under "To do in provider portal" until an admin confirms the same change there.
- **Login returns you to the page you asked for.** A deep link such as `/nl/dashboard/charge-cards`, or a coop login link with `?redirect=`, survives the login.

### Changed
- **OGM codes come from one counter per coop.** Registrations and charge cards share it, so codes never collide, and two simultaneous registrations no longer risk the same code.
```

```bash
git add CHANGELOG.md
git commit -m "chore: CHANGELOG for charge cards v1"
```

---

## Public URL for bronsgroen.be

**Link the bronsgroen.be button to:**

```
https://opencoop.be/nl/bronsgroen/login?redirect=%2Fnl%2Fdashboard%2Fcharge-cards
```

Swap both `nl` for `fr`, `en` or `de` on the other language versions of `/[locale]/laadpas`.

**What happens, verified from the route code (after Task 8):**

1. `apps/web/src/app/[locale]/[coopSlug]/login/page.tsx` redirects on the server to `/nl/bronsgroen/default/login?redirect=%2Fnl%2Fdashboard%2Fcharge-cards`. Every coop gets a default channel with slug `default` when it is created (`coops.service.ts:438`, `auth.service.ts:252`).
2. `components/auth/coop-login-content.tsx` stores the redirect (`opencoop-post-login-redirect` in localStorage, 30-minute TTL, only `/dashboard…` paths accepted).
3. **Already logged in:** that component calls `router.replace('/dashboard')`; the dashboard layout consumes the stored redirect and replaces the URL with `/nl/dashboard/charge-cards`.
4. **Logged out:** the Bronsgroen-branded login form shows. Every login method ends on `/dashboard` (password and passkey via `router.push`, magic link in a new tab via the same localStorage key, OAuth via the callback page); the dashboard layout then sends the user on to `/nl/dashboard/charge-cards`.
5. **On the page:** a user with no shareholder record sees "Charge cards are for shareholders…"; a shareholder who is not ACTIVE sees "Only active shareholders can request a charge card" with a "Become a shareholder" link to `/nl/bronsgroen/register`; if Bronsgroen has not turned the feature on, the page says charge cards are not available.

**The plain dashboard URL also works**, but without Bronsgroen branding on the login form: `https://opencoop.be/nl/dashboard/charge-cards`. Logged out, the dashboard layout stores the path and pushes `/login`; the next-intl middleware prefixes the locale (`/nl/login`, from the `NEXT_LOCALE` cookie or `Accept-Language`, default `nl`); after login the user lands on the charge-cards page.

**Before this plan (current code)**, no URL brings a logged-out shareholder to the charge-cards page: `[coopSlug]/login/page.tsx` drops the query string, the dashboard layout pushes `/login` without remembering the path, and every login flow ends on `/dashboard`.

**Existing white-label redirect for reference:** bronsgroen.be already sends `/nl/login` to `opencoop.be/nl/bronsgroen` (repo memory). `[coopSlug]/page.tsx` now forwards the query string too, so `https://opencoop.be/nl/bronsgroen?redirect=%2Fnl%2Fdashboard%2Fcharge-cards` works as well. The bronsgroen.be landing page itself is out of this repo.

## Divergences from the spec and the task list

1. **The ChargeCard schema lands in Task 2, not Task 4.** `Payment.chargeCardId` is a foreign key to `charge_cards`, so the table must exist when Payment becomes generic. Task 4 adds only the API.
2. **The spec's four entry points are now three, and `addPayment` stays registration-only.** On main, CSV import, Ponto and rematch all call `BankMatchingService.matchTransaction`, which takes its target from `OgmService.resolveOgmTarget(s)`. `manualMatch` receives an id, not an OGM, and looks a card up with `OgmService.findChargeCardTarget`. `PaymentsService.addPayment` (admin "add payment" on a registration, MCP `add_payment`) keeps its registration signature: Ponto no longer calls it, and a card fee always arrives as a bank transfer.
3. **`lastUsedAt`, `INACTIVITY` and `chargeCardInactivityMonths` are left out.** Adding them in v2 is one column and one enum value; carrying them now adds dead states to every switch.
4. **Two fields not in the spec's schema:** `paidAt` (the admin waiting time for a PAID card starts at payment) and `replacesCardId @unique` (the database enforces "replaced once").
5. **Short payments:** CSV and Ponto auto-match a card only when the amount covers `feeInclVat`; anything shorter stays UNMATCHED, as the spec says. A manual match may book a partial amount, and the card turns PAID once its payments add up.
6. **Admin cancel also works on PAID cards.** The lifecycle diagram cancels from REQUESTED only, but a paid card whose holder sold all shares has no other way out (issuing is refused). The refund happens outside OpenCoop.
7. **i18n is not a separate last task.** Emails and strings land with the code whose tests render them; Task 10 checks parity.
8. **Login return-to did not exist.** The spec assumes "not logged in → OpenCoop login" ends on the charge-cards page. Task 8 adds that.
9. **Dropped after the rebase on 4e6b2840:** the Ponto OGM-format fix, the coop scoping of `manualMatch`, the OGM normaliser in `ogm.ts` and `MatchBankTransactionDto` all shipped on main (v2026.39.1, v2026.39.2, v2026.39.4). Main's `extractOgmCode` matches a bare 12-digit OGM only when the whole reference is those 12 digits; the old plan also searched free text for one. This plan keeps main's rule.
10. **DB specs bootstrap with `migrate deploy` + `db push`, not `migrate reset`.** The existing migrations do not replay to the current schema, and Prisma refuses `migrate reset` from an AI agent. See Global Constraints.
11. **Manual match to a card lives on the bank-import page**, where main now matches every bank row; the Ponto-only dialog on the transactions page stays as it is.

## Open points (not in v1)

- **VAT invoicing.** Not built. Later: push paid cards to Odoo (odoo.bronsgroen.be) for invoicing; `Coop.chargeCardVatRate` is stored for that and unused in v1.
- **Replacement fee** of €12.00 incl. VAT is still to be confirmed by Bronsgroen.
- **Card number format** (printed number, RFID UID, or both) and **charging platform / OCPI** remain the spec's open questions.
- **Existing issues seen while planning, not changed here:** the migration history does not replay to `schema.prisma` (Ecopower, API-key and gift columns, `webauthn_credentials`, `refresh_tokens`, `audit_logs` exist only through an old `db push`), so a fresh DB built with `prisma migrate deploy` alone is unusable; `e2e/helpers/api-client.ts` reads `access_token` although `/auth/login` returns `accessToken`; `e2e/tests/auth/*.spec.ts` matches no Playwright project and never runs; `apps/web/messages/en.json` defines `meetings.convocation` twice.
