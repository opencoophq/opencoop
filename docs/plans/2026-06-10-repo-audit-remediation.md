# OpenCoop Audit Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-06-10 repo audit (Milestones 0–3), turning the existing-but-ungated test investment into a real safety net, closing two live cross-tenant data bugs, putting the money math under test, and clearing the operational blind spots — without the deliberately deferred XL items.

**Architecture:** Work in dependency order. Milestone 0 builds the safety net (CI gates + regression tests that currently FAIL) so every later fix is verified automatically. Milestone 1 lands the Critical/High security & correctness fixes (the M0 tests turn green). Milestone 2 is high-leverage hardening. Milestone 3 is quality/polish. Each task is its own branch + PR (per project rule: never push to main directly).

**Tech Stack:** NestJS 10 + Jest (`*.spec.ts`, all-mocked, ~12s), Prisma 6/PostgreSQL, Next.js 14, Playwright e2e, pnpm workspaces + Turbo, GitHub Actions → GHCR → fsn1.

**Scope decisions (locked with the user 2026-06-10):**
- **All findings, deferrals stay deferred.** NOT in scope: NestJS 11 / Prisma 7 / Tailwind 4 / next-intl 4 major upgrades, the localStorage→httpOnly-cookie auth overhaul, the Registration/Transaction ledger consolidation. Next 14→15 is the one upgrade kept (security-driven) and lives at the very end (M3.10) as an isolated project.
- **PII purge = full git history rewrite** (`git filter-repo` + force-push, coordinated window).
- **Dividend rounding = period-level** (round the period total exactly, apportion to payouts so they reconcile).

**Conventions to follow (from the codebase, not invented):**
- Tenant scoping pattern already used in registrations: `findFirst({ where: { id, coopId } })` + `throw new NotFoundException(...)` on miss (never Forbidden — don't confirm a foreign resource exists). The `// C4:` comments mark prior isolation fixes; mirror them.
- Specs mock `PrismaService` entirely (see `auth.service.spec.ts`, `registrations.service.spec.ts`). No DB in unit tests.
- Money math lives in `packages/shared/src/utils.ts` and is consumed by API + web + PDFs.
- Per project rule: every change is a branch + PR. Subagents that commit must stage named files only — never `git add -A/./-u/-a`.
- CI/workflow edits are made by a human/this session only — the autonomous feedback-to-PR pipeline must not touch `.github/`.

---

## File Structure

**New files (created by this plan):**
- `apps/api/src/common/guards/coop.guard.spec.ts` — CoopGuard branch tests (M0.2)
- `apps/api/src/common/guards/roles.guard.spec.ts` — RolesGuard tests (M0.2)
- `packages/shared/jest.config.cjs` + `packages/shared/src/utils.spec.ts` — money-math tests; `packages/shared` currently has no test runner (M0.3)
- `apps/api/src/modules/dividends/dividends.service.spec.ts` — dividends IDOR + rounding regression (M0.4 / M1.3)
- `apps/api/src/modules/payments/payments.service.spec.ts` — addPayment cross-tenant regression (M0.4)
- `apps/api/src/modules/registrations/registrations.lifecycle.spec.ts` — approve/complete/cancel arithmetic (M2.9)
- `apps/api/src/modules/bank-import/bank-import.service.spec.ts` — OGM match full/partial/none (M2.9)
- `docs/OPERATIONS.md` — deploy / rollback / backup / restore runbook (M2.1)
- `apps/web/sentry.client.config.ts`, `apps/web/sentry.server.config.ts`, `apps/web/instrumentation.ts` — web error tracking (M2.2)
- `scripts/one-off/` — quarantine dir for ad-hoc prod scripts (M1.5)

**Modified (the load-bearing ones):**
- `.github/workflows/build-deploy.yml` — add PR trigger + jest + lint(api); deploys `needs: [build, e2e]` (M0.1)
- `packages/shared/src/utils.ts` — add `apportionWithholdingTax` (M1.3)
- `apps/api/src/modules/dividends/dividends.service.ts` — thread `coopId`, period-level rounding (M1.1, M1.3)
- `apps/api/src/modules/payments/payments.service.ts` — assert `registration.coopId` (M1.2)
- `apps/api/src/modules/admin/admin.controller.ts` — pass `coopId` to dividend calls; DTOs for inline bodies (M1.1, M2.8)
- `apps/api/src/app.module.ts` + `email.service.ts` — Bull retries + cleanup (M2.3)
- `apps/{api,web}/Dockerfile`, `deploy/migrate.Dockerfile` — non-root `USER` (M1.6)
- `.gitignore` — harden (M1.5)

---

## Milestone 0 — Safety net (do first; these tasks must not be skipped)

### Task M0.1: Gate CI on lint + unit tests, and make deploys require e2e

**Files:**
- Modify: `.github/workflows/build-deploy.yml`

**Why this is first:** Today no test runs on a PR, Jest never runs in CI at all, and `deploy-acc`/`deploy-prod` only `needs: [build]` — a red e2e does not stop a prod deploy. Every later task relies on CI actually verifying it.

- [ ] **Step 1: Add a `pull_request` trigger and a fast `test` job.** Edit the `on:` block and add a new job above `e2e:`.

Change the `on:` block to:

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ["apps/docs/**"]
    tags: ["v*"]
  pull_request:
    branches: [main]
    paths-ignore: ["apps/docs/**"]
```

Add this job (runs on PRs and pushes; no DB needed — specs are all-mocked):

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Generate Prisma client
        run: pnpm db:generate
      - name: Lint (api + web)
        run: |
          pnpm --filter @opencoop/api lint
          pnpm --filter @opencoop/web exec next lint
      - name: Unit tests (api)
        run: pnpm --filter @opencoop/api test
      - name: Unit tests (shared)
        run: pnpm --filter @opencoop/shared test
```

- [ ] **Step 2: Make deploys depend on e2e.** Change both deploy jobs:

```yaml
  deploy-acc:
    needs: [build, e2e]
```
```yaml
  deploy-prod:
    needs: [build, e2e]
```

- [ ] **Step 3: Verify the workflow parses.** Run: `npx --yes @action-validator/cli .github/workflows/build-deploy.yml` (or `actionlint` if installed). Expected: no syntax errors. If neither tool is available, validate YAML with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-deploy.yml'))"` → no exception.

- [ ] **Step 4: Confirm the gate works.** Open the PR for this task with one deliberately failing assertion added to any existing spec on the branch; confirm the `test` check goes red and the PR shows it as a required check (after Step 5). Then remove the deliberate failure. (Document this in the PR description rather than committing the broken test.)

- [ ] **Step 5: Turn on branch protection (manual, GitHub UI or `gh`).** This is what makes `auto-merge.yml` safe — `gh pr merge --auto` waits for required checks.

Run:
```bash
gh api repos/opencoophq/opencoop/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[checks][][context]=test' \
  -f 'required_status_checks[checks][][context]=e2e' \
  -F 'enforce_admins=false' \
  -F 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'restrictions=null'
```
Expected: 200 with the protection JSON. Verify in Settings → Branches that `test` and `e2e` are required.

- [ ] **Step 6: Commit.**
```bash
git add .github/workflows/build-deploy.yml
git commit -m "ci: gate PRs on lint+unit tests and require e2e before deploy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** A PR shows `test` + `e2e` checks; a failing Jest or e2e blocks merge and deploy. Jest now runs in CI.
**Effort:** S · **Risk:** Low (CI-only). Note: `pnpm --filter @opencoop/shared test` requires M0.3's runner — sequence M0.3 before merging this, or temporarily drop that line and add it in M0.3's PR.

---

### Task M0.2: Guard unit tests (lock tenant isolation behavior)

**Files:**
- Create: `apps/api/src/common/guards/coop.guard.spec.ts`
- Create: `apps/api/src/common/guards/roles.guard.spec.ts`

**Context:** `CoopGuard` (`apps/api/src/common/guards/coop.guard.ts`) is 29 lines and is the entire tenant-isolation gate. It currently has zero tests. A one-line regression here leaks one coop's data to another.

- [ ] **Step 1: Write the failing CoopGuard test.**

```typescript
import { CoopGuard } from './coop.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

function ctx(user: any, coopId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { coopId } }) }),
  } as unknown as ExecutionContext;
}

describe('CoopGuard', () => {
  const guard = new CoopGuard();

  it('denies when no user is present', () => {
    expect(guard.canActivate(ctx(undefined, 'coop-a'))).toBe(false);
  });

  it('allows SYSTEM_ADMIN to access any coop', () => {
    expect(guard.canActivate(ctx({ role: 'SYSTEM_ADMIN' }, 'coop-a'))).toBe(true);
  });

  it('allows a COOP_ADMIN to access an assigned coop', () => {
    expect(
      guard.canActivate(ctx({ role: 'COOP_ADMIN', coopIds: ['coop-a', 'coop-b'] }, 'coop-a')),
    ).toBe(true);
  });

  it('forbids a COOP_ADMIN from a non-assigned coop', () => {
    expect(() =>
      guard.canActivate(ctx({ role: 'COOP_ADMIN', coopIds: ['coop-a'] }, 'coop-b')),
    ).toThrow(ForbiddenException);
  });

  it('forbids a COOP_ADMIN with undefined coopIds', () => {
    expect(() =>
      guard.canActivate(ctx({ role: 'COOP_ADMIN' }, 'coop-a')),
    ).toThrow(ForbiddenException);
  });

  it('denies a SHAREHOLDER role (falls through to false)', () => {
    expect(guard.canActivate(ctx({ role: 'SHAREHOLDER', coopIds: ['coop-a'] }, 'coop-a'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it.** Run: `pnpm --filter @opencoop/api test -- coop.guard` · Expected: PASS (the guard already implements this — the test locks the behavior).

- [ ] **Step 3: Write RolesGuard tests.** Read `apps/api/src/common/guards/roles.guard.ts` first to confirm the metadata key and `@Roles()` decorator shape, then write tests covering: no `@Roles()` metadata → allow; user role in the allowed set → allow; user role not in the set → deny. Mirror the `ExecutionContext` mock above plus a mocked `Reflector` (`{ getAllAndOverride: jest.fn().mockReturnValue(roles) }`).

- [ ] **Step 4: Run both.** Run: `pnpm --filter @opencoop/api test -- guard` · Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/api/src/common/guards/coop.guard.spec.ts apps/api/src/common/guards/roles.guard.spec.ts
git commit -m "test(guards): lock CoopGuard + RolesGuard tenant-isolation behavior

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** All guard branches asserted; runs in CI via M0.1. **Effort:** S · **Risk:** None (test-only).

---

### Task M0.3: Stand up a test runner for `packages/shared` and cover the money math

**Files:**
- Create: `packages/shared/jest.config.cjs`
- Create: `packages/shared/src/utils.spec.ts`
- Modify: `packages/shared/package.json` (add `test` script + jest devDeps if absent)

**Context:** `packages/shared` has **no test runner**. It contains `generateOgmCode`/`validateOgmCode` (mod-97, with the `checkDigit === 0 → 97` branch at `utils.ts:60`), `calculateDividend`, and `computeVestedShares` — all untested, all financially load-bearing.

- [ ] **Step 1: Add the runner.** Confirm whether the repo uses ts-jest elsewhere: `cat apps/api/jest.config.ts`. Mirror its transform. Create `packages/shared/jest.config.cjs`:

```javascript
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
};
```

Add to `packages/shared/package.json` scripts: `"test": "jest"`. If `ts-jest`/`jest`/`@types/jest` aren't already hoisted at the root, add them as devDependencies here (check root `package.json` first — they almost certainly exist for the api).

- [ ] **Step 2: Write the failing tests.**

```typescript
import {
  generateOgmCode,
  validateOgmCode,
  formatOgmCode,
  parseOgmCode,
  calculateDividend,
  computeVestedShares,
  computeTotalPaid,
} from './utils';

describe('OGM mod-97', () => {
  it('round-trips generate → validate', () => {
    for (let seq = 1; seq < 500; seq++) {
      const ogm = generateOgmCode('001', seq);
      expect(validateOgmCode(ogm)).toBe(true);
    }
  });

  it('uses 97 (not 00) when the modulo is zero', () => {
    // base divisible by 97 → checkDigit must render as "97"
    // 0010000000 mod 97: find a sequence that makes the 10-digit base divisible by 97.
    // Brute-force one in-test so the assertion is concrete:
    let hit: string | null = null;
    for (let seq = 1; seq < 10000 && !hit; seq++) {
      const base = '001' + String(seq).padStart(7, '0');
      if (BigInt(base) % 97n === 0n) hit = generateOgmCode('001', seq);
    }
    expect(hit).not.toBeNull();
    expect(hit!.slice(-5, -3)).toBe('97'); // last two pre-+++ digits
    expect(validateOgmCode(hit!)).toBe(true);
  });

  it('rejects a tampered check digit', () => {
    const ogm = parseOgmCode(generateOgmCode('001', 42));
    const wrong = formatOgmCode(ogm.slice(0, 11) + ((Number(ogm[11]) + 1) % 10));
    expect(validateOgmCode(wrong)).toBe(false);
  });

  it('format/parse are inverse', () => {
    const raw = '123456789012';
    expect(parseOgmCode(formatOgmCode(raw))).toBe(raw);
  });
});

describe('calculateDividend', () => {
  it('rounds gross/tax/net to cents and keeps gross = tax + net', () => {
    const d = calculateDividend(1000, 0.025, 0.3); // 25 gross, 7.5 tax, 17.5 net
    expect(d).toEqual({ gross: 25, tax: 7.5, net: 17.5 });
  });
  it('rounds a fractional-cent result', () => {
    const d = calculateDividend(333.33, 0.025, 0.3);
    expect(d.gross).toBeCloseTo(8.33, 2);
    expect(Math.round((d.tax + d.net) * 100) / 100).toBe(d.gross);
  });
});

describe('computeVestedShares', () => {
  it('floors shares by money paid, capped at quantity', () => {
    expect(computeVestedShares(250, 100, 5)).toBe(2);
    expect(computeVestedShares(600, 100, 5)).toBe(5); // capped
  });
  it('returns 0 for non-positive price', () => {
    expect(computeVestedShares(250, 0, 5)).toBe(0);
  });
});

describe('computeTotalPaid', () => {
  it('sums mixed numeric/string amounts', () => {
    expect(computeTotalPaid([{ amount: '10.5' }, { amount: 4.5 }])).toBe(15);
  });
});
```

- [ ] **Step 3: Run.** Run: `pnpm --filter @opencoop/shared test` · Expected: PASS (the current implementations satisfy these — this locks behavior before M1.3 touches rounding).

- [ ] **Step 4: Commit.**
```bash
git add packages/shared/jest.config.cjs packages/shared/src/utils.spec.ts packages/shared/package.json
git commit -m "test(shared): add jest runner + OGM/dividend/vesting coverage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** `pnpm --filter @opencoop/shared test` runs in CI; OGM 0→97 branch and dividend rounding are covered. **Effort:** M · **Risk:** None.

---

### Task M0.4: Failing IDOR regression tests for dividends + payments

**Files:**
- Create: `apps/api/src/modules/dividends/dividends.service.spec.ts`
- Create: `apps/api/src/modules/payments/payments.service.spec.ts`

**Context:** These document S1/S2. They must FAIL against current code and PASS after M1.1/M1.2.

- [ ] **Step 1: Write the dividends cross-tenant test.** Mock `PrismaService` so `dividendPeriod.findFirst`/`findUnique` returns `null` when the `where` doesn't include the caller's `coopId`.

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DividendsService } from './dividends.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('DividendsService tenant isolation', () => {
  let service: DividendsService;
  const prisma = {
    dividendPeriod: { findFirst: jest.fn(), findUnique: jest.fn() },
    dividendPayout: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        DividendsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = mod.get(DividendsService);
  });

  it('findById scopes by coopId and 404s on a foreign period', async () => {
    // Simulate a scoped lookup: returns null because the period belongs to another coop
    prisma.dividendPeriod.findFirst.mockResolvedValue(null);
    await expect(service.findById('period-of-coop-B', 'coop-A')).rejects.toThrow(NotFoundException);
    // Assert the query was scoped (the where included coopId)
    expect(prisma.dividendPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'period-of-coop-B', coopId: 'coop-A' }) }),
    );
  });
});
```

> Note: this test calls `findById(id, coopId)` — the **two-argument** signature that M1.1 introduces. It will not compile against current code (one arg), which is the intended "fails first" state. Same for `calculate`/`markAsPaid`/`exportToCsv` — add one assertion each that the scoped lookup includes `coopId`.

- [ ] **Step 2: Write the payments cross-tenant test.**

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';

describe('PaymentsService.addPayment tenant isolation', () => {
  let service: PaymentsService;
  const prisma = { registration: { findUnique: jest.fn() }, payment: { create: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RegistrationsService, useValue: { onRegistrationCompleted: jest.fn() } },
        { provide: AdminNotificationsService, useValue: { notifyAdminsOnEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = mod.get(PaymentsService);
  });

  it('rejects a payment when the registration belongs to another coop', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      id: 'reg-B', coopId: 'coop-B', status: 'PENDING_PAYMENT', totalAmount: 100, payments: [],
    });
    await expect(
      service.addPayment({ registrationId: 'reg-B', coopId: 'coop-A', amount: 50, bankDate: new Date() }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run and confirm they FAIL.** Run: `pnpm --filter @opencoop/api test -- dividends.service payments.service` · Expected: FAIL (dividends won't compile with 2-arg call; payments creates the payment today). Record the failure in the PR.

- [ ] **Step 4: Commit (red tests, on the M1 branch).** These ship together with M1.1/M1.2 — commit them on the same branch so CI never sees a red main.
```bash
git add apps/api/src/modules/dividends/dividends.service.spec.ts apps/api/src/modules/payments/payments.service.spec.ts
git commit -m "test(security): failing regressions for dividends + payments cross-tenant IDOR

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** Tests fail on current code, will pass after M1.1/M1.2. **Effort:** S · **Risk:** None.

---

## Milestone 1 — Critical fixes (security & correctness)

### Task M1.1: Fix the dividends cross-tenant IDOR (S1)

**Files:**
- Modify: `apps/api/src/modules/dividends/dividends.service.ts` (`findById`, `calculate`, `markAsPaid`, `exportToCsv`)
- Modify: `apps/api/src/modules/admin/admin.controller.ts:833,852,863,875` (call sites)

**Bug:** All four methods look up the period by bare `id` with no `coopId`. A Coop A admin with a Coop B period id reads/exports/mutates Coop B's payouts. Mirror the registrations `// C4:` pattern.

- [ ] **Step 1: Thread `coopId` into `findById`.** Change the signature and the lookup:

```typescript
async findById(id: string, coopId: string) {
  const period = await this.prisma.dividendPeriod.findFirst({
    where: { id, coopId }, // C4-style: tenant isolation
    include: {
      payouts: {
        include: {
          shareholder: {
            select: { id: true, type: true, firstName: true, lastName: true, companyName: true, email: true },
          },
        },
      },
    },
  });
  if (!period) {
    throw new NotFoundException('Dividend period not found');
  }
  // ...rest unchanged
}
```

- [ ] **Step 2: Scope `calculate`, `markAsPaid`, `exportToCsv` the same way.** Each takes `coopId` and replaces its `findUnique({ where: { id } })` / `findUnique({ where: { id: periodId } })` with `findFirst({ where: { id/periodId, coopId } })`. Update the internal `return this.findById(periodId)` calls to `this.findById(periodId, coopId)` (two places: end of `calculate` and `markAsPaid`). The `calculate` method's `eligibleRegistrations` query already scopes by `period.coopId` — leave it, but you can now assert `period.coopId === coopId` is implied by the scoped lookup.

- [ ] **Step 3: Update the controller call sites** in `admin.controller.ts` — each handler already has `@Param('coopId') coopId` available except `getDividendPeriod`, `calculateDividends`, `markDividendsPaid`, `exportDividends`, which currently only take `@Param('id')`. Add `@Param('coopId') coopId: string` to each and pass it:

```typescript
@Get('dividends/:id')
@RequirePermission('canManageDividends')
async getDividendPeriod(@Param('coopId') coopId: string, @Param('id') id: string) {
  return this.dividendsService.findById(id, coopId);
}

@Post('dividends/:id/calculate')
@RequirePermission('canManageDividends')
async calculateDividends(
  @Param('coopId') coopId: string, @Param('id') id: string,
  @CurrentUser() user: CurrentUserData, @Req() req: Request,
) {
  return this.dividendsService.calculate(id, coopId, user.id, req.ip, req.headers['user-agent']);
}

@Post('dividends/:id/mark-paid')
@RequirePermission('canManageDividends')
async markDividendsPaid(
  @Param('coopId') coopId: string, @Param('id') id: string,
  @CurrentUser() user: CurrentUserData, @Req() req: Request,
  @Body('paymentReference') paymentReference?: string,
) {
  return this.dividendsService.markAsPaid(id, coopId, paymentReference, user.id, req.ip, req.headers['user-agent']);
}

@Get('dividends/:id/export')
@RequirePermission('canManageDividends')
async exportDividends(@Param('coopId') coopId: string, @Param('id') id: string, @Res() res: Response) {
  const csv = await this.dividendsService.exportToCsv(id, coopId);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="dividend-payouts-${id}.csv"`);
  res.send(csv);
}
```

Update the service signatures to match the new argument order: `calculate(periodId, coopId, actorId?, ip?, userAgent?)`, `markAsPaid(periodId, coopId, paymentReference?, actorId?, ip?, userAgent?)`, `exportToCsv(periodId, coopId)`.

- [ ] **Step 4: Run the M0.4 dividends regression.** Run: `pnpm --filter @opencoop/api test -- dividends.service` · Expected: PASS now. Also run the full api suite to catch other call sites: `pnpm --filter @opencoop/api test` · Expected: green (grep for any other `dividendsService.` callers first: `grep -rn "dividendsService\." apps/api/src`).

- [ ] **Step 5: Typecheck.** Run: `pnpm --filter @opencoop/api build` · Expected: no TS errors (this catches missed call sites).

- [ ] **Step 6: Commit.**
```bash
git add apps/api/src/modules/dividends/dividends.service.ts apps/api/src/modules/admin/admin.controller.ts
git commit -m "fix(security): scope all dividend period lookups by coopId (closes cross-tenant IDOR)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** A cross-coop period id returns 404; M0.4 dividends test passes. **Effort:** S · **Risk:** Low.

---

### Task M1.2: Fix the addPayment cross-tenant write (S2)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:47-54`

**Bug:** `addPayment` looks up the registration by bare id and never checks `registration.coopId === data.coopId`, so a Coop A admin can pay/complete a Coop B registration.

- [ ] **Step 1: Add the tenant assertion** right after the existing null check:

```typescript
const registration = await this.prisma.registration.findUnique({
  where: { id: data.registrationId },
  include: { payments: true },
});

if (!registration || registration.coopId !== data.coopId) {
  // C4-style: do not confirm a foreign registration exists
  throw new NotFoundException('Registration not found');
}
```

(Replace the existing `if (!registration) { throw new NotFoundException('Registration not found'); }` block.)

- [ ] **Step 2: Run the M0.4 payments regression.** Run: `pnpm --filter @opencoop/api test -- payments.service` · Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add apps/api/src/modules/payments/payments.service.ts
git commit -m "fix(security): reject cross-tenant payments in addPayment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** Paying a foreign registration returns 404, no Payment row created. **Effort:** S · **Risk:** Low.

> M1.1 + M1.2 + their M0.4 tests ship as **one PR** so main never carries a known-failing security test.

---

### Task M1.3: Period-level dividend rounding (T2)

**Files:**
- Modify: `packages/shared/src/utils.ts` (add `apportionWithholdingTax`)
- Modify: `packages/shared/src/utils.spec.ts` (test the helper)
- Modify: `apps/api/src/modules/dividends/dividends.service.ts:264-289` (use it)
- Modify: `apps/api/src/modules/dividends/dividends.service.spec.ts` (reconciliation test)

**Bug:** `dividends.service.ts:266` computes payout tax as raw float (`sumGross * rate`), discarding `calculateDividend`'s rounded values; unrounded numbers persist into payouts, the CSV, and PDFs. User chose **period-level rounding**: the period total tax must equal `round(totalGross × rate)` exactly, with the cents apportioned across payouts.

- [ ] **Step 1: Write the failing helper test** in `packages/shared/src/utils.spec.ts`:

```typescript
import { apportionWithholdingTax } from './utils';

describe('apportionWithholdingTax (period-level rounding)', () => {
  it('sum of per-payout tax equals the rounded period total', () => {
    const grosses = [33.33, 33.33, 33.34]; // €100 total
    const rate = 0.3;
    const taxes = apportionWithholdingTax(grosses, rate);
    const periodTarget = Math.round(100 * rate * 100) / 100; // 30.00
    const sum = Math.round(taxes.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(periodTarget);
    taxes.forEach((t) => expect(Math.round(t * 100)).toBe(t * 100)); // whole cents
  });

  it('handles a single payout exactly', () => {
    expect(apportionWithholdingTax([50], 0.3)).toEqual([15]);
  });

  it('handles an empty list', () => {
    expect(apportionWithholdingTax([], 0.3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail.** Run: `pnpm --filter @opencoop/shared test -- apportion` · Expected: FAIL (not defined).

- [ ] **Step 3: Implement the helper** in `packages/shared/src/utils.ts` (largest-remainder apportionment, integer cents internally):

```typescript
/**
 * Apportion withholding tax across payouts so the per-payout taxes sum exactly to
 * the period-level target round(sum(gross) * rate). Largest-remainder method.
 * @param grossAmounts per-payout gross amounts (euros, already rounded to cents)
 * @param rate withholding tax rate (e.g. 0.30)
 * @returns per-payout tax amounts in euros (whole cents), same order as input
 */
export function apportionWithholdingTax(grossAmounts: number[], rate: number): number[] {
  if (grossAmounts.length === 0) return [];
  const totalGrossCents = grossAmounts.reduce((a, g) => a + Math.round(g * 100), 0);
  const targetTaxCents = Math.round(totalGrossCents * rate);

  const exact = grossAmounts.map((g) => Math.round(g * 100) * rate); // cents, fractional
  const floored = exact.map((x) => Math.floor(x));
  const allocated = floored.reduce((a, b) => a + b, 0);
  let remainder = targetTaxCents - allocated;

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const cents = [...floored];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    cents[order[k].i] += 1;
  }
  return cents.map((c) => c / 100);
}
```

- [ ] **Step 4: Run → pass.** Run: `pnpm --filter @opencoop/shared test -- apportion` · Expected: PASS.

- [ ] **Step 5: Use it in the service.** In `calculate`, replace lines 264-277 (`sumGross`/`tax`/`net` per payout) so gross is computed per payout but tax is apportioned across the whole set afterward. Restructure: first build the payout list with `grossAmount` (= rounded `sumGross`), then apportion:

```typescript
// after the for-loop builds `payouts` with grossAmount set, before createMany:
const grosses = payouts.map((p) => Math.round(p.grossAmount * 100) / 100);
const taxes = apportionWithholdingTax(grosses, Number(period.withholdingTaxRate));
payouts.forEach((p, idx) => {
  p.grossAmount = grosses[idx];
  p.withholdingTax = taxes[idx];
  p.netAmount = Math.round((grosses[idx] - taxes[idx]) * 100) / 100;
});
```

Set each payout's interim `grossAmount = sumGross` and drop the per-payout `tax`/`net` computation at lines 266-267 (they're now overwritten). Import `apportionWithholdingTax` alongside `calculateDividend`.

- [ ] **Step 6: Add a service reconciliation test** in `dividends.service.spec.ts`: mock eligible registrations for 3 shareholders whose grosses sum to a value where naive per-payout rounding drifts, then assert `sum(payout.withholdingTax) === round(totalGross * rate)` from the `createMany` argument. Run: `pnpm --filter @opencoop/api test -- dividends.service` · Expected: PASS.

- [ ] **Step 7: One-time audit query (no auto-fix).** Document in the PR a read-only check the operator runs against prod to see if existing payouts carry float dust before any backfill decision:
```sql
SELECT id, "grossAmount", "withholdingTax", round("grossAmount" * dp."withholdingTaxRate", 2) AS expected
FROM "DividendPayout" pay JOIN "DividendPeriod" dp ON dp.id = pay."dividendPeriodId"
WHERE pay."withholdingTax" <> round("grossAmount" * dp."withholdingTaxRate", 2);
```
Do NOT run a backfill automatically — Bronsgroen periods were created via ad-hoc scripts; reconcile against what was actually paid (Open Question #2).

- [ ] **Step 8: Commit.**
```bash
git add packages/shared/src/utils.ts packages/shared/src/utils.spec.ts apps/api/src/modules/dividends/dividends.service.ts apps/api/src/modules/dividends/dividends.service.spec.ts
git commit -m "fix(dividends): period-level rounding so payout taxes reconcile to the period total

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** Persisted payout `tax`/`net` are whole cents; `sum(payout.tax) == round(totalGross × rate)`; CSV/PDF amounts exact. **Effort:** S–M · **Risk:** Medium (changes persisted financial values for *new* calculations — verify against an existing period before/after; no retroactive backfill).

---

### Task M1.4: Dependency vulnerability burn-down (round 1) + audit in CI

**Files:**
- Modify: root `package.json` / `apps/*/package.json` / `apps/api/package.json`, `pnpm-lock.yaml`
- Modify: `.github/workflows/build-deploy.yml` (non-blocking audit report)

**Context:** `pnpm audit --prod` reports 35 high. Biggest real exposure: `next@14.2.35`, `multer@1.x` (deprecated), `nodemailer@6`, `undici`, and `hono` via `@modelcontextprotocol/sdk` (public MCP route). Deferred: Next 14→15 (that's M3.10).

- [ ] **Step 1: Patch the cheap, low-API-surface ones first.** Run each, rebuild, run e2e locally between:
```bash
pnpm --filter @opencoop/api add multer@^2 @types/multer@latest
pnpm --filter @opencoop/api add nodemailer@^8 @types/nodemailer@latest
pnpm --filter @opencoop/api add @modelcontextprotocol/sdk@latest @rekog/mcp-nest@latest
pnpm --filter @opencoop/api add undici@latest
pnpm add next@14.2.x   # latest 14.2 patch only — NOT 15 yet
```
After each: `pnpm install && pnpm --filter @opencoop/api build`.

- [ ] **Step 2: Verify the multer 1→2 upgrade.** Multer 2 changed some defaults; read the upload call sites (`grep -rn "FileInterceptor\|multer" apps/api/src`) and confirm the RSVP volmacht upload + bank-import upload still parse. Run the relevant specs and the e2e upload paths.

- [ ] **Step 3: Verify nodemailer 6→8.** Read `email.processor.ts` transport setup; confirm `createTransport` options still valid. Send a test mail via the dev SMTP if available.

- [ ] **Step 4: Re-audit.** Run: `pnpm audit --prod` · Expected: high count materially reduced (target < 5, excluding anything only fixable by Next 15 — note those for M3.10).

- [ ] **Step 5: Add a non-blocking audit report to CI** in the `test` job (so it surfaces without gating yet):
```yaml
      - name: Dependency audit (report only)
        run: pnpm audit --prod || true
```

- [ ] **Step 6: Run full local verification.** `pnpm build && pnpm --filter @opencoop/api test`. Build Docker images locally per project rule before pushing: `docker build -f apps/api/Dockerfile .`.

- [ ] **Step 7: Commit.**
```bash
git add package.json apps/api/package.json pnpm-lock.yaml .github/workflows/build-deploy.yml
git commit -m "chore(deps): bump multer/nodemailer/mcp-sdk/undici + latest next 14.2 patch; audit in CI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** `pnpm audit --prod` high count < 5 (Next-15-only advisories excepted and noted); e2e green; Docker builds locally. **Effort:** M · **Risk:** Medium (mail + upload paths — covered by e2e).

---

### Task M1.5: Purge committed PII from git history + harden ignores

**Files:**
- History: `agents/cmo/campaigns/brevo-segments/S1_actieve_cooperanten.csv` (+ S2, S3)
- Modify: `.gitignore`
- Create: `scripts/one-off/` (move ad-hoc prod scripts here)
- Remove from tracking: `apps/web/tsconfig.tsbuildinfo`

**Context:** 739 rows of real member PII are in permanent history. User chose a **full history rewrite**. This is the one task with real process risk — coordinate.

- [ ] **Step 1: Pre-flight (manual, coordinate).** Announce a freeze window. Ensure no open PRs/branches will be force-clobbered (`git branch -r`, `gh pr list --state open`). Pause the feedback-to-PR launchd job. Take a full mirror backup first: `git clone --mirror . ../opencoop-backup-$(git rev-parse --short HEAD).git`.

- [ ] **Step 2: Identify every PII path in history.**
```bash
git log --all --oneline -- 'agents/cmo/campaigns/brevo-segments/*.csv'
git rev-list --all --objects | grep brevo-segments || true
```

- [ ] **Step 3: Rewrite history with git-filter-repo** (install via `brew install git-filter-repo`):
```bash
git filter-repo --force \
  --path agents/cmo/campaigns/brevo-segments/ --invert-paths
```
If other PII files surfaced in Step 2, add more `--path ... --invert-paths`. Expected: filter-repo reports the removed paths and rewrites refs.

- [ ] **Step 4: Re-add the remote** (filter-repo strips it) and force-push all branches + tags:
```bash
git remote add origin git@github.com:opencoophq/opencoop.git
git push --force --all origin
git push --force --tags origin
```

- [ ] **Step 5: Harden `.gitignore`.** Append:
```gitignore
# Agent scratch + memory (never commit)
/agents/
/memory/
# One-off scripts compiled artifacts
packages/database/prisma/*.js
packages/database/prisma/*.d.ts
# Editor/OS/temp
*.tmp
.~lock.*#
# Build info (was committed before this rule)
*.tsbuildinfo
```

- [ ] **Step 6: Untrack the build-info and quarantine one-offs.**
```bash
git rm --cached apps/web/tsconfig.tsbuildinfo
mkdir -p scripts/one-off
git mv packages/database/prisma/fix-*.ts packages/database/prisma/merge-*.ts scripts/one-off/ 2>/dev/null || true
```
(Keep `seed.ts`, `seed-demo.ts`, and the `migrations/` dir in place — only move ad-hoc customer fixes. Review each before moving.)

- [ ] **Step 7: Verify.** `git log --all --oneline -- 'agents/cmo/campaigns/brevo-segments/*.csv'` → empty. Fresh clone + `pnpm install && pnpm build` → `git status` clean.

- [ ] **Step 8: Commit the ignore/move changes** (the history rewrite is already pushed):
```bash
git add .gitignore && git commit -m "chore(repo): harden gitignore, untrack build-info, quarantine one-off scripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Post-flight.** Re-enable the feedback pipeline. Notify any collaborators to re-clone (their old clones still contain the PII).

**Acceptance:** CSVs absent from `git log --all`; fresh clone+build leaves `git status` clean. **Effort:** M · **Risk:** High process risk (history rewrite) — backup + freeze window mandatory. Do in a quiet window, not during AGM activity.

---

### Task M1.6: Run containers as non-root (S3)

**Files:**
- Modify: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `deploy/migrate.Dockerfile`

**Context:** None of the three production stages declare `USER` — all run as root.

- [ ] **Step 1: Read each Dockerfile's final stage** to find the workdir and any dirs that need write access (`apps/api` creates `/app/uploads`).

- [ ] **Step 2: Add a non-root user to the API image** (Alpine). In the final stage, before `CMD`:
```dockerfile
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app
```

- [ ] **Step 3: Add to the web image** (Next.js standalone already often has a `nextjs` user — check first; if not):
```dockerfile
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
```
Keep `ENV HOSTNAME=0.0.0.0` (per memory — required for the dual-network bind).

- [ ] **Step 4: Add to migrate image** similarly (it only needs to run prisma; no volume writes).

- [ ] **Step 5: Build all three locally** (project rule — never push Dockerfile changes unbuilt):
```bash
docker build -f apps/api/Dockerfile .
docker build -f apps/web/Dockerfile .
docker build -f deploy/migrate.Dockerfile .
```
Expected: all succeed.

- [ ] **Step 6: Verify uploads still writable on acc.** After deploy to acc, confirm a logo/signature upload works (the `api_uploads` volume must be writable by the new uid — if the existing volume is root-owned, add a one-time `chown` on the server or an init step). Watch the deploy per the "always follow up deployments" rule.

- [ ] **Step 7: Commit.**
```bash
git add apps/api/Dockerfile apps/web/Dockerfile deploy/migrate.Dockerfile
git commit -m "security: run api/web/migrate containers as non-root

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Acceptance:** Containers run as non-root; uploads still work on acc. **Effort:** S · **Risk:** Medium (volume permissions — test on acc before tagging prod).

---

## Milestone 2 — High-leverage improvements

### Task M2.1: Operational runbook + post-deploy health gate + restore drill

**Files:**
- Create: `docs/OPERATIONS.md`
- Modify: `.github/workflows/build-deploy.yml` (post-deploy health probe)

- [ ] **Step 1: Add a post-deploy health probe** to both deploy jobs' SSH scripts so a broken deploy fails the workflow instead of reporting green:
```bash
            docker compose pull
            docker compose up -d
            echo "Waiting for API health..."
            for i in $(seq 1 30); do
              if curl -fsS http://localhost:3001/health >/dev/null 2>&1; then echo "healthy"; exit 0; fi
              sleep 2
            done
            echo "API did not become healthy" >&2; exit 1
```
(Adjust the curl target to whatever is reachable on the box — internal container port or the Caddy route. Confirm the health path: it's `/health` per `health.controller.ts`.)

- [ ] **Step 2: Write `docs/OPERATIONS.md`** covering, concretely: the deploy flow (push→acc, tag→prod), **rollback** (`ssh wouter@fsn1...`, `cd ~/opencoop/prod`, edit `TAG=` to the previous good SHA, `docker compose up -d --force-recreate` — NOT `down`, per the volume-name memory), where backups live (fra1 Borg, stanford replica), and the restore steps. Cross-reference the private infra notes without duplicating secrets.

- [ ] **Step 3: Rehearse one restore on acc** (per TECHNICAL_DEBT.md — never been done). Document the actual steps + timing in OPERATIONS.md.

- [ ] **Step 4: Commit.**
```bash
git add docs/OPERATIONS.md .github/workflows/build-deploy.yml
git commit -m "ops: post-deploy health gate + OPERATIONS runbook (deploy/rollback/restore)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
- [ ] **Step 5: Set up an external uptime monitor** (manual — UptimeRobot/Better Stack on `https://opencoop.be/api/health`, alert to Telegram/email). Note it in OPERATIONS.md.

**Acceptance:** A failed deploy turns the workflow red; rollback + restore documented and the restore rehearsed once. **Effort:** M · **Risk:** Low.

---

### Task M2.2: Web error tracking (Sentry on Next.js) (O5)

**Files:**
- Create: `apps/web/sentry.client.config.ts`, `apps/web/sentry.server.config.ts`, `apps/web/instrumentation.ts`
- Modify: `apps/web/next.config.js`, `apps/web/package.json`, `deploy/docker-compose.yml` (pass `NEXT_PUBLIC_SENTRY_DSN`)

- [ ] **Step 1:** `pnpm --filter @opencoop/web add @sentry/nextjs`.
- [ ] **Step 2:** Run `npx @sentry/wizard@latest -i nextjs` inside `apps/web` OR hand-create the three config files with `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 })`, gated so it's a no-op when the DSN is unset (mirror the API's "no-op if unset" convention).
- [ ] **Step 3:** Wrap `next.config.js` with `withSentryConfig`. Keep source-map upload optional (needs `SENTRY_AUTH_TOKEN` — fine to defer).
- [ ] **Step 4:** Add `NEXT_PUBLIC_SENTRY_DSN` to `deploy/docker-compose.yml` web env and `.env.example`.
- [ ] **Step 5:** Verify a thrown test error reaches Sentry from a dev build. Build locally: `pnpm --filter @opencoop/web build`.
- [ ] **Step 6: Commit** (named files only).

**Acceptance:** A client-side throw appears in Sentry; no-op when DSN unset. **Effort:** S · **Risk:** Low.

---

### Task M2.3: Email queue resilience (retries + cleanup) (P5/F6)

**Files:**
- Modify: `apps/api/src/app.module.ts:50-55` (BullModule.forRoot)
- Modify: `apps/api/src/modules/email/email.service.ts:85,444` (per-add options)

- [ ] **Step 1: Add `defaultJobOptions`** to `BullModule.forRoot`:
```typescript
BullModule.forRoot({
  // ...existing redis config...
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: 500,
  },
}),
```
(Read the current `forRoot` first to preserve the redis connection block exactly.)

- [ ] **Step 2: Confirm the processor is idempotent enough for retries** — `email.processor.ts` already marks `EmailLog` FAILED on error; ensure a retried send won't double-insert an EmailLog (it should update by id, not create per attempt). If it creates per attempt, guard it.
- [ ] **Step 3: Test.** Add/extend an email service spec asserting `queue.add` is called and that a forced processor throw is retried (mock the queue). Run: `pnpm --filter @opencoop/api test -- email`.
- [ ] **Step 4: Commit.**

**Acceptance:** Transient SMTP failure retries 3×; completed jobs don't accumulate in Redis. **Effort:** S · **Risk:** Low.

---

### Task M2.4: Move AGM convocation send to a Bull job (P2)

**Files:**
- Modify: `apps/api/src/modules/meetings/convocation.service.ts:170-333`
- Create: a convocation processor (mirror `email.processor.ts` / `reminder.scheduler.ts` patterns) + register a `convocation` queue in the meetings module
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts:186-192` (enqueue instead of awaiting the full render loop)

**Context:** The send endpoint renders N PDFs inline on the event loop — minutes-long, stalls all tenants. Idempotency via `convocationSentAt` already exists; preserve it.

- [ ] **Step 1:** Read `convocation.service.ts` fully and the existing `reminder.scheduler.ts` for the queue-registration pattern in this module.
- [ ] **Step 2:** Register a `convocation` Bull queue; move the per-shareholder upsert + `renderToBuffer` + email enqueue into a processor that handles one shareholder (or a chunk) per job. The controller endpoint enqueues jobs and returns immediately with a count.
- [ ] **Step 3:** Preserve idempotency — the processor checks/sets `convocationSentAt` so a re-run after partial failure doesn't double-mail.
- [ ] **Step 4:** Add a spec asserting the endpoint enqueues N jobs (mock the queue) and the processor sets `convocationSentAt`. Run the meetings specs.
- [ ] **Step 5:** Manually verify on acc with the demo coop. **Step 6:** Commit.

**Acceptance:** Send for a 500-shareholder coop returns immediately; PDFs render off the request path; no double-mailing on retry. **Effort:** M · **Risk:** Medium (AGM-critical — land well before any real AGM cycle, after M0 gates exist).

---

### Task M2.5: Stop the `pageSize=10000` client-side pagination (P1)

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/shareholders/page.tsx:229`
- Modify: `apps/web/src/app/[locale]/dashboard/admin/transactions/page.tsx:176`

**Context:** Both pages fetch up to 10k rows and paginate in the browser, pulling heavy includes + per-row decryption. The backend already implements correct `skip/take` + count.

- [ ] **Step 1:** Read both pages to see how they consume the response (they expect a full array today). Refactor to request real pages (`page`, `pageSize<=50`) and move the search/filter terms into server query params (the services already support filtering — confirm in `shareholders.service.ts` / the registrations/transactions service).
- [ ] **Step 2:** Wire pagination controls to server pages; show server total count. Keep the existing table UI.
- [ ] **Step 3:** Verify the e2e admin shareholders/transactions specs still pass (they assert visible rows); update selectors if needed.
- [ ] **Step 4:** Manually verify on acc with Bronsgroen-scale data if available. **Step 5:** Commit.

**Acceptance:** Pages request ≤50 rows; filters are server-side; e2e green. **Effort:** L · **Risk:** Medium (most-used admin pages — rely on M0 e2e gate).

---

### Task M2.6: Throttle + slim public surfaces (S6/S7)

**Files:**
- Modify: `apps/api/src/modules/feature-requests/feature-requests.controller.ts:12`
- Modify: `apps/api/src/modules/migration-requests/*.controller.ts` (the public POST)
- Modify: `apps/api/src/modules/meetings/meeting-kiosk.controller.ts:25`, `kiosk.service.ts:69-102`

- [ ] **Step 1:** Add `@Throttle({ default: { ttl: 60000, limit: 3 } })` to the public feature-request and migration-request POST routes (import `Throttle` from `@nestjs/throttler`; auth routes already use this pattern — mirror them).
- [ ] **Step 2:** Add a tight `@Throttle` to the kiosk `:token/search` route.
- [ ] **Step 3:** Drop `address` from the kiosk search projection in `kiosk.service.ts` (it isn't needed to identify a member at check-in — confirm against the kiosk UI; this is Open Question #4, default to dropping).
- [ ] **Step 4:** Add/extend a spec asserting the 4th request/min is throttled (or assert the decorator metadata is present) and that the kiosk response has no `address`. Run the relevant specs.
- [ ] **Step 5:** Commit.

**Acceptance:** 4th request/min → 429; kiosk search response omits `address`. **Effort:** S · **Risk:** Low.

---

### Task M2.7: Truth-up the docs (O7/O9)

**Files:**
- Modify: `.claude/CLAUDE.md`, `README.md`, `.env.example`, `deploy/docker-compose.yml`

- [ ] **Step 1:** Fix CLAUDE.md: model count 27→**48** (`grep -c '^model ' packages/database/prisma/schema.prisma` to confirm), remove "React Query for server state" and "next-auth" claims (neither is a dependency — state the real pattern: `useEffect` + `api()` helper, JWT via `lib/api.ts`), correct the MCP line ("requires a coop API key via `McpAuthMiddleware`, per-key tenant scoping" — code is safer than the old "public, no auth" claim), fix the Swagger path (`/docs` locally; disabled when `NODE_ENV=production`), change "Nginx" → "Caddy", and replace the stale `docker-compose up -d && prisma migrate deploy` deployment section with the real GHCR-image + migrate-container flow (reference `docs/OPERATIONS.md`).
- [ ] **Step 2:** Spot-check README quick-start against reality (env vars, ports).
- [ ] **Step 3:** Complete `.env.example`: add the 7 `PONTO_*`, `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `APPLE_*`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `GITHUB_TOKEN`, `MEETING_TIME_ZONE`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (group as "Optional integrations"). Decide whether `PONTO_*` should pass through `deploy/docker-compose.yml` (it currently doesn't — add it if Ponto runs in prod; Open Question implicit).
- [ ] **Step 4:** Commit.

**Acceptance:** A fresh agent following CLAUDE.md hits no 404s / phantom deps; model count + MCP + Swagger + state-management lines correct. **Effort:** S · **Risk:** None.

---

### Task M2.8: DTOs for the 9 inline-typed `@Body()` endpoints (Q7)

**Files:**
- Create DTOs under the relevant `dto/` dirs; Modify: `admin.controller.ts:703,715,730`, `meeting-kiosk.controller.ts:36`, `system.controller.ts:184`, `auth.controller.ts:310-366` (4 webauthn)

**Context:** `ValidationPipe` does nothing for inline types. Payment mutations (`amount`) and plan/trial changes arrive unvalidated. Do payment endpoints first.

- [ ] **Step 1:** Create `AddPaymentDto` (`@IsNumber()` + `@IsPositive() amount`, `@IsDateString() bankDate`) and `UpdatePaymentDateDto` / `CompleteRegistrationDto` (`@IsOptional() @IsDateString() bankDate`). Replace the inline `@Body() body: {...}` types in `admin.controller.ts:703/715/730` and drop the now-redundant manual `if (!body?.amount...)` guards (the DTO enforces them). Mirror the existing DTO style in the module's `dto/` dir.
- [ ] **Step 2:** Create DTOs for the kiosk check-in body (`shareholderId`, `signaturePngDataUrl`), the system plan/trial body, and the 4 webauthn bodies. Read each handler to capture exact fields.
- [ ] **Step 3:** Add specs asserting an invalid payload (negative amount, missing field) yields 400. Run the api suite; run e2e (purchase/payment paths).
- [ ] **Step 4:** Commit.

**Acceptance:** Invalid payloads return 400 with field errors; e2e green. **Effort:** S–M · **Risk:** Low.

---

### Task M2.9: Behavioral specs for registration lifecycle + bank-import matching (T4)

**Files:**
- Create: `apps/api/src/modules/registrations/registrations.lifecycle.spec.ts`
- Create: `apps/api/src/modules/bank-import/bank-import.service.spec.ts`

- [ ] **Step 1:** Read `registrations.service.ts:509-569` (`approve`/`complete`/`cancel`) and `bank-import.service.ts:86-180`.
- [ ] **Step 2:** Lifecycle specs (mock Prisma + `$transaction`): `approve` flips PENDING→PENDING_PAYMENT; `complete` creates the residual Payment with `remaining = totalAmount - totalPaid` and Decimal→Number coercion correct; `cancel` transitions and guards; sell-flow share-availability check. Assert the **arithmetic and the resulting status**, not just that a method ran.
- [ ] **Step 3:** Bank-import specs: OGM extraction from a memo line; full match → registration COMPLETED; partial payment → ACTIVE + remaining tracked; no-match → UNMATCHED row. Use the real `validateOgmCode`/`generateOgmCode` to build fixtures.
- [ ] **Step 4:** Run: `pnpm --filter @opencoop/api test -- registrations bank-import` · Expected: PASS. **Step 5:** Commit.

**Acceptance:** State transitions + Decimal arithmetic asserted incl. partial-payment edge case. **Effort:** M · **Risk:** None (test-only; if a test reveals a real bug, fix in a separate task).

---

## Milestone 3 — Quality & polish

> These are lower-severity. Each is still a branch + PR. For the larger refactors (M3.1, M3.2) land the M0 test coverage for the touched code first so the refactor is verifiable.

### Task M3.1: Centralize email templating (Q5/F3)
**Files:** new `apps/api/src/modules/email/templates/` + locale files; refactor `email.processor.ts:270-1209` and the inline HTML in `auth.service.ts:1384+`.
- [ ] Extract the ~15 templates into a small renderer that pulls copy from locale files (not hardcoded 4-language string literals), with HTML-escaping for any user-interpolated value. Move auth.service's inline verification/waitlist HTML into the same place. Add a spec that renders each template in each locale without throwing and escapes a `<script>` in an interpolated field.
- [ ] Verify a representative email renders identically before/after (snapshot). Commit.
**Acceptance:** One place to change branding; copy lives in locale files; user-interpolated values escaped. **Effort:** L · **Risk:** Medium (touches every transactional email — snapshot before/after).

### Task M3.2: Split `auth.service.ts` + extract `admin.service.ts` (Q2/Q3)
**Files:** `auth.service.ts` (1,764 lines) → `auth.service.ts` (core) + `mfa.service.ts` + `oauth.service.ts` + `magic-link.service.ts` (+ templates moved in M3.1); new `admin.service.ts` taking the business logic + the raw-SQL capital aggregation out of `admin.controller.ts:295-330` (single source of truth with `reports.service`).
- [ ] **Prerequisite:** ensure auth + admin paths have spec coverage first (extend M0.2/auth specs). This is **XL — break into sub-tasks per extracted service**, one PR each, behavior-preserving (move, don't rewrite). Run the full api suite + e2e after each extraction.
**Acceptance:** No file > ~600 lines in auth/admin; capital formula defined once; all tests green. **Effort:** XL (decompose) · **Risk:** Medium-High (security-critical file — incremental, test-gated).

### Task M3.3: Shared formatters + shared shareholder form + toast (Q9)
**Files:** add `formatDate(iso, locale)` to `packages/shared` (or a `useFormatters()` hook), delete the 19 local copies; extract one shareholder personal/company form component used by the 4 call sites (`admin/shareholders/page.tsx`, `[id]/page.tsx`, `personal-data/page.tsx`, `coop-register-content.tsx`); replace `alert()`/`confirm()` in the registration funnel with the existing toast.
- [ ] Do the formatter consolidation first (mechanical, low-risk). Then the form extraction (verify all 4 pages still submit). Then toasts. Separate PRs. **Effort:** M · **Risk:** Low-Medium.

### Task M3.4: Error/empty/retry states for dashboard loads (Q4)
**Files:** add a tiny `useApiData` hook (loading/error/data) and replace the `.catch(() => {})` swallow on the 20+ dashboard pages.
- [ ] Build the hook + tests; migrate the worst offenders first (`admin/billing`, `admin/page`, `admin/shareholders`, `system/audit`). Show an error state + retry instead of a silently empty table. **Effort:** M · **Risk:** Low.

### Task M3.5: Merge `api()` / `apiFetch()` (Q6)
**Files:** `apps/web/src/lib/api.ts:89-184`.
- [ ] Unify into one implementation (keep the better error-body parsing from `api()`); update the few `apiFetch` callers. Do this **before** anyone touches the "login state lost" bug so the fix lands once. **Effort:** S · **Risk:** Low (security-sensitive refresh flow — test login/refresh/401 paths in e2e).

### Task M3.6: Indexes + retention (P4/P6/P7)
**Files:** `packages/database/prisma/schema.prisma` (+ a migration); a retention cron.
- [ ] Add `@@index([coopId, matchStatus])` to `BankTransaction`, `@@index([shareholderId])` to `DividendPayout`, `@@index([coopId])` to `EmailLog`. Generate a migration (`pnpm db:migrate`), not `db push`. Add a monthly cron (Bull repeatable or the existing scheduler) pruning EmailLog/AuditLog beyond a retention window + expired RefreshToken/MagicLinkToken rows + orphaned convocation PDFs. **Effort:** S–M · **Risk:** Low (additive migration; retention deletes are the only thing to review carefully — start with a long window).

### Task M3.7: Resolve the dead validators (Q8)
**Files:** `packages/shared/src/utils.ts:71-173` + registration DTOs.
- [ ] **Decision first (Open Question #3):** wire IBAN/VAT/national-ID validators into the registration DTOs (risk: rejecting real edge-case inputs — make them warnings or lenient), OR delete them as dead code. If wiring in: add `@Validate` custom validators + tests with real Belgian samples. **Effort:** S · **Risk:** Low (but a too-strict validator could block real signups — prefer non-blocking warnings).

### Task M3.8: Batch bank-import + chunk shareholder import (P3)
**Files:** `bank-import.service.ts:77-130`, `shareholder-import.service.ts:384-448`.
- [ ] Bank import: one `findMany({ where: { ogmCode: { in } } })` for OGM lookups + `createMany` for unmatched rows instead of per-row round-trips. Shareholder import: `createMany` for independent primary rows; only the linked two-pass rows need the interactive transaction, and raise its `timeout`/`maxWait`. Add specs for a large batch. **Effort:** M · **Risk:** Low-Medium (verify matching parity with the M2.9 specs).

### Task M3.9: E2E hardening (T7)
**Files:** `e2e/tests/shareholder/purchase-shares.spec.ts`, `e2e/global-setup.ts`, `playwright.config.ts`.
- [ ] Assert DB-visible outcomes on the purchase path (created registration/amount/OGM via an admin view or API check), remove the `waitForTimeout` sleeps (replace with `waitForResponse`/`expect(...).toBeVisible()`), and add per-test data isolation so specs stop depending on shared mutable seed state. **Effort:** M · **Risk:** Low.

### Task M3.10: Next.js 14 → 15 migration (D1) — isolated final project
**Files:** `apps/web` (Next 15; React 18 retained).
- [ ] **Do last, on its own branch, after M0.1 gates exist** so e2e verifies it. Follow the official 14→15 codemod (`npx @next/codemod@latest upgrade`), address the async `cookies()/headers()/params` changes, rebuild, run full e2e. This closes the Next-only advisories left from M1.4. **Effort:** L · **Risk:** Medium (framework upgrade — gated by e2e; revert is a branch away).

---

## Quick wins (do immediately — high impact, S effort)
1. **M0.1** CI gating (~5 lines YAML + branch protection) — converts all existing tests into protection.
2. **M1.1 + M1.2** the two `coopId` fixes (one PR) — close active cross-tenant exposure.
3. **M2.3** email retries + Redis cleanup.
4. **M2.6** public-surface throttles + kiosk projection trim.
5. **M2.7** CLAUDE.md truth-up — immediate quality boost for every autonomous PR.
6. **M1.6** Dockerfile `USER` directives.
7. **M2.2** web Sentry.

## Recommended execution order
1. **M0.1 → M0.3 → M0.2** (safety net + runner; M0.1's shared-test line needs M0.3).
2. **M0.4 + M1.1 + M1.2 + M1.3** as the security/money PR cluster (M0.4 red tests ship with their fixes).
3. **M1.6, M2.3, M2.6, M2.7, M2.2** quick wins in parallel branches.
4. **M1.4** dependency burn-down; **M2.1** ops runbook + restore drill.
5. **M1.5** PII history rewrite — in a coordinated quiet window (pause feedback pipeline).
6. **M2.4, M2.5, M2.8, M2.9** high-leverage hardening.
7. **M3.x** polish; **M3.10** Next 15 last.

## Open Questions (carried from the audit — answer before the dependent task)
1. **Open-source intent** → done: history rewrite chosen (M1.5).
2. **Dividend rounding policy** → done: period-level (M1.3). *Remaining:* does Bronsgroen's accountant need to sign off before any backfill of existing payouts? (M1.3 Step 7 — no auto-backfill until answered.)
3. **Dead validators (Q8/M3.7):** wire IBAN/VAT/national-ID validation into registration input (risk of rejecting real users) or delete?
4. **Kiosk `address` field (M2.6):** safe to drop from check-in search, or needed to disambiguate same-name members?
5. **localStorage auth:** confirmed staying as-is (deferred) — flag so no feedback-pipeline PR "fixes" it ad hoc.
6. **`PONTO_*` in prod compose (M2.7):** should Ponto run in prod? If yes, add the env passthrough.

---

## Self-Review

**Spec coverage:** Every audit finding maps to a task — S1→M1.1, S2→M1.2, S3→M1.6, S4 (deferred, noted), S5→M1.4, S6/S7→M2.6, S8 (root compose — covered by M2.7 doc + note; prod already safe), S9 (accepted); T1/O1→M0.1, T2→M1.3, T3→M0.3, T4→M2.9, T5→M0.2, T6 (web tests — partial via M3.9/M3.4; full web unit suite is a deferred larger effort, noted), T7→M3.9, T8 (coverage thresholds — fold into M0.1 follow-up); P1→M2.5, P2→M2.4, P3→M3.8, P4/P6/P7→M3.6, P5→M2.3; Q1→structurally addressed by M1.1/M1.2 + M0.2 (full Prisma-extension enforcement noted as a future option, not built — calibrated), Q2/Q3→M3.2, Q4→M3.4, Q5→M3.1, Q6→M3.5, Q7→M2.8, Q8→M3.7, Q9→M3.3, Q10/Q11 (circular deps / ledger — deferred per scope), Q12 (any/ponto cast — fold into M3.2 touch); O2→M2.1, O3→M2.1, O4→M1.5, O5→M2.2, O6→M0.1 (api lint added), O7/O9→M2.7, O8→M2.1, O10→M1.5.

**Gaps acknowledged (deferred by scope decision, not oversight):** localStorage→cookie auth (S4), full multi-tenant Prisma-extension enforcement (Q1 hardening beyond the two fixes), Registration/Transaction consolidation (Q11), major framework upgrades except Next 15. A full `apps/web` unit-test suite (T6) is started via M3.4/M3.9 but not completed — flag as a follow-up if web regressions continue.

**Type consistency:** New service signatures are consistent across tasks — `findById(id, coopId)`, `calculate(periodId, coopId, actorId?, ip?, userAgent?)`, `markAsPaid(periodId, coopId, paymentReference?, ...)`, `exportToCsv(periodId, coopId)` — used identically in M0.4 tests, M1.1 service, and M1.1 controller call sites. `apportionWithholdingTax(grossAmounts: number[], rate: number): number[]` defined in M1.3 Step 3 and consumed in Step 5 with matching shape.
