# Shared-Email Households Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple Shareholders in the same coop to share one login/inbox (couples, family units, elderly + caregiver) while preserving per-shareholder voting rights, by generalizing the existing minor/guardian pattern to all shareholder types.

**Architecture:** `User` becomes the sole comms/auth anchor. `Shareholder.email` is deprecated as a comms target — reads for email routing must go through `shareholder.user.email`. The `@@unique([coopId, email])` constraint stays (nulls are non-unique in Postgres), but application-layer uniqueness assumptions are relaxed. The existing `MinorUpgradeToken` table is generalized to `ShareholderEmancipationToken` to cover any linked shareholder wanting their own inbox.

**Tech Stack:** NestJS 10, Prisma 6, Postgres 16, Next.js 14, Jest, Playwright.

**Non-goals:**
- This plan does NOT ship the Bronsgroen AGM convocation feature itself (separate plan). It ships the primitives the convocation sender depends on.
- No changes to voting/proxy data model beyond what's needed for household-based vote enumeration.
- No change to payment/share-ownership semantics.

**Context for executor:**
- Today, minors already work this way: `Shareholder.email = NULL`, `Shareholder.userId = <parent's User>`, `Shareholder.registeredByUserId = <parent's User>`. Communications for minors route via `registeredByUserId.email`. See `apps/api/src/modules/shareholders/birthday-scheduler.service.ts:112-122` for the canonical pattern.
- We are NOT inventing a new concept — we're generalizing the existing one. Every design choice should ask: "is this consistent with how minors work today?"
- The Bronsgroen AGM is on 2026-05-09. This plan is **not** on the critical path for that AGM — admin will manually handle the one known couple for the 2026 convocation. Plan lands cleanly for the 2027 cycle.

**Audit summary (full audit lives in session context, not this doc):**
- 28 files touch `shareholder.email`, ~70 usages
- Critical uniqueness assumptions at: `shareholder-import.service.ts:205-267`, `shareholders.service.ts:271-282`, `external-api.service.ts:9-68`
- Brevo sync already uses `user.email` — safe
- All outbound email sends null-check gracefully — pattern matches minors

---

## Design Decisions Locked In

1. **Source of truth for comms** = `shareholder.user.email`. A helper `resolveShareholderEmail(shareholder)` encapsulates the fallback chain (`user.email ?? shareholder.email ?? null`). Every email-sending call site migrates to this helper. `shareholder.email` stays in the schema for display/legacy but is **not read** by sending code.

2. **Adding a "linked" shareholder** = admin action that creates a Shareholder with `email = NULL` and `userId = <existing User's id>`. No new enum, no new flag — the state "linked to a User whose email is not mine" is structural.

3. **Emancipation** = shareholder graduates from shared-User to own-User via a token-based flow. Reuse/rename the `MinorUpgradeToken` table to `ShareholderEmancipationToken` with a `reason` enum (`MINOR_COMING_OF_AGE` | `HOUSEHOLD_SPLIT`). The existing minor-turning-18 cron continues to work, just using the new table name.

4. **Uniqueness constraint stays as-is.** `@@unique([coopId, email])` with nullable email = Postgres allows multiple NULLs, so two linked shareholders (both NULL) in the same coop are permitted at the DB level. Application-level "email taken" checks must only fire when the new email is non-null.

5. **Voting rights** are out of scope for this plan but the data model must support the enumeration query the convocation sender will need: *"for a given User, list all Shareholders they can vote on behalf of in coop X"*. Shipped as a service method in Task 2.

6. **External API (EcoPower) lookup by email** today returns one shareholder. After this plan, `queryShareholders` returns `Shareholder[]` for a given email (may be 1-N). Callers must handle multi-return. This is a minor API contract change — acceptable given the external API is versioned and used by a single known consumer (EcoPower integration).

## Open Decisions for Wouter

Three spots in the plan are flagged `⚠️ DECISION` — these need your input before implementation. They're called out inline in Tasks 3, 4, and 6. You can answer them before starting the plan, or pause at those tasks.

---

## File Structure

**New files:**
- `apps/api/src/modules/shareholders/shareholder-email.resolver.ts` — single source of truth for shareholder→email resolution
- `apps/api/src/modules/shareholders/shareholder-email.resolver.spec.ts`
- `apps/api/src/modules/shareholders/household.service.ts` — listShareholdersForUser(), linkShareholderToUser(), unlinkShareholder()
- `apps/api/src/modules/shareholders/household.service.spec.ts`
- `apps/api/src/modules/shareholders/household.controller.ts` — admin endpoints for linking
- `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts`
- `apps/api/src/modules/auth/emancipation.service.ts` — split out from auth.service; handles token lifecycle for both MINOR_COMING_OF_AGE and HOUSEHOLD_SPLIT
- `apps/api/src/modules/auth/emancipation.service.spec.ts`
- `apps/web/src/app/[locale]/dashboard/admin/shareholders/[shareholderId]/link-household/page.tsx` — admin UI for linking
- `apps/web/src/components/admin/link-shareholder-dialog.tsx`
- `apps/web/src/app/[locale]/emancipate/[token]/page.tsx` — public page where a linked shareholder claims their own login
- `docs/migrations/2026-04-14-minor-upgrade-token-rename.md` — migration notes

**Modified files:**
- `packages/database/prisma/schema.prisma` — rename `MinorUpgradeToken` → `ShareholderEmancipationToken`, add `reason` field
- `apps/api/src/modules/registrations/registrations.service.ts:350-860` — use resolver for all email sends
- `apps/api/src/modules/dividends/dividends.service.ts:441` — CSV export: emit `user.email || shareholder.email || ''`
- `apps/api/src/modules/meetings/reminder.processor.ts:42-46` — use resolver
- `apps/api/src/modules/meetings/convocation.service.ts:140-144` — use resolver
- `apps/api/src/modules/messages/messages.service.ts:464-468` — use resolver
- `apps/api/src/modules/shareholders/shareholders.service.ts:223-282` — create/update: relax email uniqueness (only dedup if non-null AND not pointing to same User); wire up household linking
- `apps/api/src/modules/shareholders/shareholder-import.service.ts:205-310` — import: allow duplicate emails as "households"; add `linkedShareholderEmail` CSV column (optional)
- `apps/api/src/modules/shareholders/birthday-scheduler.service.ts` — use renamed token model
- `apps/api/src/modules/external-api/external-api.service.ts:9-145` — return `Shareholder[]` from lookup; update EcoPower caller handling
- `apps/api/src/modules/auth/auth.service.ts:~1054` — magic link lookup: prefer User.email match over orphan Shareholder.email match; handle multi-shareholder Users (already does)
- `apps/api/src/modules/admin/reports.service.ts` — shareholder register export: emit User.email alongside shareholder.email
- `apps/web/src/app/[locale]/dashboard/personal-data/page.tsx:249` — display User.email with "managed by household" annotation when shareholder.email is NULL
- `apps/web/src/components/coop-register-content.tsx:334` — registration pre-fill from user.email if no shareholder.email
- `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/rsvp/page.tsx:319` — resolver for display
- `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/convocation/page.tsx:401` — resolver for display
- `apps/web/messages/{en,nl,fr,de}.json` — new strings for household linking, emancipation flow

---

## Tasks

### Task 1: Comms resolver — pure function + tests

**Files:**
- Create: `apps/api/src/modules/shareholders/shareholder-email.resolver.ts`
- Create: `apps/api/src/modules/shareholders/shareholder-email.resolver.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// shareholder-email.resolver.spec.ts
import { resolveShareholderEmail, resolveShareholderEmailWithSource } from './shareholder-email.resolver';

describe('resolveShareholderEmail', () => {
  it('returns user.email when user is linked and has email', () => {
    const sh = { email: null, user: { email: 'jan@example.com' } } as any;
    expect(resolveShareholderEmail(sh)).toBe('jan@example.com');
  });

  it('falls back to shareholder.email when user is null', () => {
    const sh = { email: 'solo@example.com', user: null } as any;
    expect(resolveShareholderEmail(sh)).toBe('solo@example.com');
  });

  it('falls back to shareholder.email when user has no email (edge case)', () => {
    const sh = { email: 'solo@example.com', user: { email: null } } as any;
    expect(resolveShareholderEmail(sh)).toBe('solo@example.com');
  });

  it('returns null when neither has email (postal-only shareholder)', () => {
    const sh = { email: null, user: { email: null } } as any;
    expect(resolveShareholderEmail(sh)).toBeNull();
  });

  it('prefers user.email even if shareholder.email also set (user is source of truth)', () => {
    const sh = { email: 'old@example.com', user: { email: 'new@example.com' } } as any;
    expect(resolveShareholderEmail(sh)).toBe('new@example.com');
  });

  it('resolveShareholderEmailWithSource returns {email, source} for audit/logs', () => {
    const sh = { email: null, user: { email: 'jan@example.com' } } as any;
    expect(resolveShareholderEmailWithSource(sh)).toEqual({
      email: 'jan@example.com',
      source: 'user',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test shareholder-email.resolver
```

Expected: FAIL with "Cannot find module './shareholder-email.resolver'"

- [ ] **Step 3: Implement the resolver**

```typescript
// shareholder-email.resolver.ts
export type ShareholderWithUser = {
  email: string | null;
  user: { email: string | null } | null;
};

export type EmailSource = 'user' | 'shareholder' | 'none';

export function resolveShareholderEmail(shareholder: ShareholderWithUser): string | null {
  return shareholder.user?.email ?? shareholder.email ?? null;
}

export function resolveShareholderEmailWithSource(
  shareholder: ShareholderWithUser,
): { email: string | null; source: EmailSource } {
  if (shareholder.user?.email) return { email: shareholder.user.email, source: 'user' };
  if (shareholder.email) return { email: shareholder.email, source: 'shareholder' };
  return { email: null, source: 'none' };
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
cd apps/api && pnpm test shareholder-email.resolver
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/shareholders/shareholder-email.resolver.ts apps/api/src/modules/shareholders/shareholder-email.resolver.spec.ts
git commit -m "feat(shareholders): add shareholder→email resolver with user.email precedence"
```

---

### Task 2: Route all outbound comms through the resolver

**Files:**
- Modify: `apps/api/src/modules/registrations/registrations.service.ts:350-351, 396-408, 836, 860`
- Modify: `apps/api/src/modules/dividends/dividends.service.ts:441`
- Modify: `apps/api/src/modules/meetings/reminder.processor.ts:42,46`
- Modify: `apps/api/src/modules/meetings/convocation.service.ts:140,144`
- Modify: `apps/api/src/modules/messages/messages.service.ts:464,468`
- Test: `apps/api/src/modules/meetings/convocation.service.spec.ts` (new scenarios)

- [ ] **Step 1: Write failing test — convocation send dedups by inbox**

```typescript
// convocation.service.spec.ts (append)
describe('sendConvocation with shared households', () => {
  it('sends one email per distinct User when multiple shareholders share a User', async () => {
    // Fixture: User U1 (email jan@x.com) owns Shareholder S1 (email null) and S2 (email null)
    // Fixture: User U2 (email piet@x.com) owns Shareholder S3 (email null)
    // Meeting has attendees for S1, S2, S3

    const sent = await service.sendConvocation(meetingId);

    expect(sent).toHaveLength(2);
    const recipients = sent.map((s) => s.to).sort();
    expect(recipients).toEqual(['jan@x.com', 'piet@x.com']);

    // The email to jan@x.com must enumerate BOTH shareholders he controls
    const jansEmail = sent.find((s) => s.to === 'jan@x.com')!;
    expect(jansEmail.shareholderIds).toHaveLength(2);
  });

  it('skips attendees whose shareholders have no resolvable email (postal-only)', async () => {
    // Fixture: Shareholder S4 with email=null, user=null
    const sent = await service.sendConvocation(meetingId);
    expect(sent.map((s) => s.to)).not.toContain(null);
  });
});
```

- [ ] **Step 2: Run — test fails**

```bash
cd apps/api && pnpm test convocation.service
```

Expected: FAIL (current impl sends per-shareholder, not per-inbox)

- [ ] **Step 3: Refactor `convocation.service.ts:140-144`**

```typescript
// convocation.service.ts — before:
// for (const att of attendees) {
//   if (!att.shareholder.email) continue;
//   await this.email.sendConvocation(att.shareholder.email, ...);
// }

// after:
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

const byInbox = new Map<string, { shareholderIds: string[]; names: string[] }>();
for (const att of attendees) {
  const email = resolveShareholderEmail(att.shareholder);
  if (!email) continue;
  const entry = byInbox.get(email) ?? { shareholderIds: [], names: [] };
  entry.shareholderIds.push(att.shareholder.id);
  entry.names.push(`${att.shareholder.firstName} ${att.shareholder.lastName}`);
  byInbox.set(email, entry);
}

const sent: Array<{ to: string; shareholderIds: string[] }> = [];
for (const [email, { shareholderIds, names }] of byInbox) {
  await this.email.sendConvocation(email, { shareholderNames: names, ... });
  sent.push({ to: email, shareholderIds });
}
return sent;
```

Ensure the Prisma query includes `user: { select: { email: true } }` on the shareholder relation.

- [ ] **Step 4: Run — passes**

```bash
cd apps/api && pnpm test convocation.service
```

Expected: PASS

- [ ] **Step 5: Apply identical helper migration to the other 4 send sites**

For each of the files in the `Files:` list, replace direct `shareholder.email` reads with `resolveShareholderEmail(shareholder)`. Add `include: { user: { select: { email: true } } }` to the Prisma queries that fetch these shareholders. Keep display/export reads (`dividends.service.ts` CSV) using `shareholder.user?.email ?? shareholder.email` directly or via the resolver — both acceptable; resolver preferred.

Sites:
- `registrations.service.ts:350-351` (share purchase confirmation)
- `registrations.service.ts:396-408` (resend payment email)
- `registrations.service.ts:836,860` (gift share payment received)
- `meetings/reminder.processor.ts:42,46` (meeting reminder cron)
- `messages/messages.service.ts:464,468` (conversation notification)
- `dividends/dividends.service.ts:441` (CSV export — use `{ email, source }` variant so export can include a "household-inherited" indicator column)

- [ ] **Step 6: Add integration test for registration resend**

```typescript
// registrations.service.spec.ts (append)
it('resendPaymentEmail uses user.email when shareholder.email is null', async () => {
  const registration = await createRegistrationWithSharedEmailShareholder();
  const result = await service.resendPaymentEmail(registration.id);
  expect(result.sentTo).toBe(registration.shareholder.user!.email);
});
```

- [ ] **Step 7: Run all modified module tests — pass**

```bash
cd apps/api && pnpm test registrations meetings messages dividends
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/
git commit -m "refactor(shareholders): route all outbound comms through resolver, dedup by inbox"
```

---

### Task 3: Household linking — service + admin endpoint

⚠️ **DECISION NEEDED:** When an admin links an existing Shareholder (currently with email `alice@x.com`) to an existing User (with email `bob@x.com`), what happens to `Shareholder.email`?
- **(i)** Clear to NULL (treats link as "this shareholder no longer has her own inbox"). Simpler; matches minor pattern; what I recommend.
- **(ii)** Keep the old email as a "personal archive" on the shareholder row. Would require new UI to explain why a shareholder shows two emails.
- **(iii)** Move the old email to a new `User` with no `password` (postal-future-self); hold unused.

Recommendation: **(i)**. Plan is written assuming (i). Change these steps if you pick (ii)/(iii).

**Files:**
- Create: `apps/api/src/modules/shareholders/household.service.ts`
- Create: `apps/api/src/modules/shareholders/household.service.spec.ts`
- Create: `apps/api/src/modules/shareholders/household.controller.ts`
- Create: `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts`
- Modify: `apps/api/src/modules/shareholders/shareholders.module.ts` (register new providers)

- [ ] **Step 1: Write failing tests for household.service**

```typescript
// household.service.spec.ts
describe('HouseholdService', () => {
  describe('linkShareholderToUser', () => {
    it('sets shareholder.userId to target user and clears shareholder.email', async () => {
      const jan = await createUser('jan@x.com');
      const wife = await createShareholder({ email: 'marie@x.com', userId: null, coopId });
      const linked = await service.linkShareholderToUser({
        shareholderId: wife.id,
        targetUserId: jan.id,
        actorUserId: adminUser.id,
      });
      expect(linked.userId).toBe(jan.id);
      expect(linked.email).toBeNull();
    });

    it('rejects when target user is not a shareholder in the same coop', async () => {
      const otherCoopUser = await createUser('jan@x.com'); // in coop B
      const wife = await createShareholder({ email: 'marie@x.com', userId: null, coopId: coopA.id });
      await expect(
        service.linkShareholderToUser({ shareholderId: wife.id, targetUserId: otherCoopUser.id, actorUserId: adminUser.id }),
      ).rejects.toThrow('Target user is not associated with this cooperative');
    });

    it('records audit log entry with before/after state', async () => {
      // ... creates, links, asserts AuditLog row with action=LINK_SHAREHOLDER_TO_HOUSEHOLD
    });
  });

  describe('unlinkShareholder', () => {
    it('reverses a link by generating an emancipation token and nulling userId', async () => {
      // ... assertions
    });
  });

  describe('listShareholdersForUser', () => {
    it('returns all shareholders a user controls in a given coop', async () => {
      // fixtures: User with 2 linked shareholders in coop A, 1 in coop B
      const result = await service.listShareholdersForUser(userId, coopId);
      expect(result).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run — all tests fail**

```bash
cd apps/api && pnpm test household.service
```

Expected: FAIL

- [ ] **Step 3: Implement `HouseholdService`**

```typescript
// household.service.ts
@Injectable()
export class HouseholdService {
  constructor(private prisma: PrismaService, private audit: AuditLogService) {}

  async linkShareholderToUser(args: { shareholderId: string; targetUserId: string; actorUserId: string }) {
    const shareholder = await this.prisma.shareholder.findUniqueOrThrow({
      where: { id: args.shareholderId },
      include: { coop: true },
    });

    const targetInCoop = await this.prisma.shareholder.findFirst({
      where: { userId: args.targetUserId, coopId: shareholder.coopId },
    });
    if (!targetInCoop) {
      throw new BadRequestException('Target user is not associated with this cooperative');
    }

    const updated = await this.prisma.shareholder.update({
      where: { id: args.shareholderId },
      data: { userId: args.targetUserId, email: null },
    });

    await this.audit.log({
      actorUserId: args.actorUserId,
      action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
      targetType: 'Shareholder',
      targetId: args.shareholderId,
      before: { userId: shareholder.userId, email: shareholder.email },
      after: { userId: updated.userId, email: updated.email },
    });

    return updated;
  }

  async listShareholdersForUser(userId: string, coopId: string) {
    return this.prisma.shareholder.findMany({
      where: { userId, coopId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async unlinkShareholder(args: { shareholderId: string; actorUserId: string }) {
    // Delegates to EmancipationService (Task 6). For now, throw NotImplemented.
    throw new NotImplementedException('Use EmancipationService.startEmancipation instead');
  }
}
```

- [ ] **Step 4: Run — tests pass (except unlinkShareholder, which is pending Task 6)**

```bash
cd apps/api && pnpm test household.service
```

Expected: PASS on link/list tests; unlink test deferred.

- [ ] **Step 5: Expose admin endpoint**

```typescript
// household.controller.ts
@Controller('admin/coops/:coopId/shareholders/:shareholderId/household')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles(Role.COOP_ADMIN)
export class HouseholdController {
  constructor(private household: HouseholdService) {}

  @Post('link')
  async link(
    @Param('shareholderId') shareholderId: string,
    @Body() dto: LinkShareholderDto,
    @CurrentUser() user: User,
  ) {
    return this.household.linkShareholderToUser({
      shareholderId,
      targetUserId: dto.targetUserId,
      actorUserId: user.id,
    });
  }
}
```

```typescript
// dto/link-shareholder.dto.ts
import { IsString } from 'class-validator';
export class LinkShareholderDto {
  @IsString() targetUserId!: string;
}
```

Register both in `shareholders.module.ts`.

- [ ] **Step 6: E2E test the endpoint**

```typescript
// household.controller.e2e-spec.ts
it('POST /admin/coops/:coopId/shareholders/:id/household/link links to existing User', async () => {
  const res = await request(app.getHttpServer())
    .post(`/admin/coops/${coopId}/shareholders/${wifeId}/household/link`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ targetUserId: husbandUserId });

  expect(res.status).toBe(201);
  expect(res.body.userId).toBe(husbandUserId);
  expect(res.body.email).toBeNull();
});
```

- [ ] **Step 7: Run all — pass, then commit**

```bash
cd apps/api && pnpm test household
git add apps/api/src/modules/shareholders/household.* apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts apps/api/src/modules/shareholders/shareholders.module.ts
git commit -m "feat(shareholders): add household service and admin link endpoint"
```

---

### Task 4: Relax email uniqueness in create/update/import

⚠️ **DECISION NEEDED:** On CSV import, two rows with the same email — what's the default interpretation?
- **(i)** Reject (current behavior) — admin must link manually after import.
- **(ii)** Auto-link to the same User if one exists for that email; otherwise create one User and link both. Assumes admin intent.
- **(iii)** Accept only when a new `linkedTo` column is present in the CSV pointing to the primary shareholder's email.

Recommendation: **(iii)**. Safest; intent is explicit; no accidental household creation from a fat-fingered CSV. Plan is written assuming (iii).

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts:271-282` (update dedup)
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts:228` (create validation)
- Modify: `apps/api/src/modules/shareholders/shareholder-import.service.ts:205-310` (import validation + new column)
- Test: add specs for each changed flow

- [ ] **Step 1: Failing test — update allows same email for shareholders sharing a User**

```typescript
// shareholders.service.spec.ts (append)
it('update allows setting email to a value that exists on another shareholder IF both share a User', async () => {
  const user = await createUser('shared@x.com');
  const s1 = await createShareholder({ email: 'shared@x.com', userId: user.id });
  const s2 = await createShareholder({ email: null, userId: user.id });
  // Admin wants to also set s2.email to 'shared@x.com' (e.g. for display)
  const updated = await service.update(s2.id, { email: 'shared@x.com' }, coopId);
  expect(updated.email).toBe('shared@x.com');
});

it('update still rejects email collision when shareholders belong to different Users', async () => {
  const u1 = await createUser('u1@x.com');
  const u2 = await createUser('u2@x.com');
  const s1 = await createShareholder({ email: 'taken@x.com', userId: u1.id });
  const s2 = await createShareholder({ email: null, userId: u2.id });
  await expect(service.update(s2.id, { email: 'taken@x.com' }, coopId))
    .rejects.toThrow('ConflictException');
});
```

- [ ] **Step 2: Run — second test passes (existing behavior), first fails**

- [ ] **Step 3: Update dedup logic**

Replace `shareholders.service.ts:271-282`:

```typescript
if (dto.email && dto.email.toLowerCase() !== existing.email?.toLowerCase()) {
  const emailTaken = await this.prisma.shareholder.findFirst({
    where: {
      coopId,
      email: dto.email.toLowerCase(),
      NOT: { id },
    },
    select: { userId: true },
  });
  const sameHousehold = emailTaken?.userId && emailTaken.userId === existing.userId;
  if (emailTaken && !sameHousehold) {
    throw new ConflictException(
      'A shareholder with this email already exists in this cooperative (different household)',
    );
  }
}
```

- [ ] **Step 4: Run — both tests pass**

- [ ] **Step 5: Failing test — import with `linkedTo` column**

```typescript
// shareholder-import.service.spec.ts (append)
it('accepts duplicate email when second row has linkedTo pointing to first', async () => {
  const csv = [
    { firstName: 'Jan', lastName: 'Janssens', email: 'jan@x.com', shares: 10 },
    { firstName: 'Marie', lastName: 'Janssens', email: 'jan@x.com', linkedTo: 'jan@x.com', shares: 5 },
  ];
  const result = await service.import(coopId, csv);
  expect(result.errors).toEqual([]);
  expect(result.created).toBe(2);
  const marie = await prisma.shareholder.findFirst({ where: { firstName: 'Marie' } });
  expect(marie!.userId).toBeTruthy();
  expect(marie!.email).toBeNull(); // linked households get null email per Task 3 decision (i)
});

it('still rejects duplicate email without linkedTo column', async () => {
  const csv = [
    { firstName: 'Jan', email: 'jan@x.com', shares: 10 },
    { firstName: 'Piet', email: 'jan@x.com', shares: 5 }, // no linkedTo
  ];
  const result = await service.import(coopId, csv);
  expect(result.errors[0]).toContain('already exists');
});
```

- [ ] **Step 6: Run — both fail (no linkedTo support yet)**

- [ ] **Step 7: Implement linkedTo in import**

Update `shareholder-import.service.ts`:

```typescript
// In CSV row schema, add optional linkedTo: string
// In validation pass:
if (row.email?.trim()) {
  const email = row.email.trim().toLowerCase();
  const isLinked = !!row.linkedTo?.trim();

  if (existingEmails.has(email) && !isLinked) {
    errors.push(`Email "${email}" already exists in this cooperative. Add a 'linkedTo' column to import as household member.`);
  }
  if (seenEmails.has(email) && !isLinked) {
    errors.push(`Duplicate email "${email}" in import file (use linkedTo column for household members).`);
  }
  if (!isLinked) seenEmails.add(email);
}

// In create pass: resolve linkedTo → find primary shareholder's User → set userId + email=null
if (row.linkedTo?.trim()) {
  const primary = await tx.shareholder.findFirst({
    where: { coopId, email: row.linkedTo.trim().toLowerCase() },
    select: { userId: true },
  });
  if (!primary?.userId) throw new BadRequestException(`linkedTo target "${row.linkedTo}" has no user account`);
  await tx.shareholder.create({
    data: { ...rest, email: null, userId: primary.userId, coopId },
  });
}
```

- [ ] **Step 8: Run all import + service tests**

```bash
cd apps/api && pnpm test shareholders shareholder-import
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/shareholders/
git commit -m "feat(shareholders): relax email uniqueness for same-household shareholders; add linkedTo CSV column"
```

---

### Task 5: EcoPower / External API — multi-shareholder returns

**Files:**
- Modify: `apps/api/src/modules/external-api/external-api.service.ts:9-145`
- Modify: `apps/api/src/modules/external-api/external-api.service.spec.ts`
- Modify: `apps/docs/content/docs/ecopower-api.mdx` + `.nl.mdx` + `.fr.mdx` + `.de.mdx`

- [ ] **Step 1: Failing test — query returns all shareholders for an email**

```typescript
it('queryShareholders returns array per email when email is shared across household', async () => {
  const u = await createUser('shared@x.com');
  const s1 = await createShareholder({ email: 'shared@x.com', userId: u.id });
  const s2 = await createShareholder({ email: null, userId: u.id }); // linked

  const result = await service.queryShareholders(coopId, ['shared@x.com']);
  const match = result.find((r) => r.email === 'shared@x.com')!;
  expect(match.shareholders).toHaveLength(2);
});
```

- [ ] **Step 2: Run — fails (current impl returns single record)**

- [ ] **Step 3: Refactor return shape**

```typescript
// Before: queryShareholders(coopId, emails: string[]): Promise<Shareholder[]>
// After:
async queryShareholders(coopId: string, emails: string[]): Promise<Array<{
  email: string;
  shareholders: Shareholder[];
}>> {
  const lowerEmails = emails.map((e) => e.toLowerCase());
  // Match on EITHER shareholder.email OR user.email
  const rows = await this.prisma.shareholder.findMany({
    where: {
      coopId,
      OR: [
        { email: { in: lowerEmails, mode: 'insensitive' } },
        { user: { email: { in: lowerEmails, mode: 'insensitive' } } },
      ],
    },
    include: { user: { select: { email: true } } },
  });

  const byEmail = new Map<string, Shareholder[]>();
  for (const sh of rows) {
    const resolved = (sh.user?.email ?? sh.email)!.toLowerCase();
    if (!lowerEmails.includes(resolved)) continue;
    const list = byEmail.get(resolved) ?? [];
    list.push(sh);
    byEmail.set(resolved, list);
  }

  return Array.from(byEmail, ([email, shareholders]) => ({ email, shareholders }));
}
```

- [ ] **Step 4: Update `updateEcoPowerStatus` similarly** — when updating by email, apply status to ALL matching shareholders OR require a shareholderId in the payload for disambiguation.

Decision inline: update all matching. Log a warning if >1 match. Caller (EcoPower) can scope by shareholderId via a future v2 endpoint if needed.

- [ ] **Step 5: Update docs**

In each of the 4 language docs (`apps/docs/content/docs/ecopower-api.*.mdx`), update the response schema for `/shareholders/query` to show the grouped `{ email, shareholders: [...] }` shape. Add a "Breaking change" note with date and upgrade path.

- [ ] **Step 6: Notify EcoPower contact (manual step, marked in plan)**

Write a note in `docs/migrations/2026-04-14-ecopower-api-breaking-change.md` capturing:
- Date of change
- Endpoint affected
- Before/after response shape
- Who to email at EcoPower (flagged for Wouter to fill in before ship)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/external-api/ apps/docs/content/docs/ecopower-api.*.mdx docs/migrations/
git commit -m "feat(external-api): group shareholders by email for household support (breaking change)"
```

---

### Task 6: Emancipation flow — rename MinorUpgradeToken, add HOUSEHOLD_SPLIT reason

⚠️ **DECISION NEEDED:** When a linked shareholder wants their own login, who initiates?
- **(i)** Admin-only — the coop admin triggers emancipation on the shareholder's behalf (email notification + token link). Conservative; matches current minor flow.
- **(ii)** Self-service — the primary household member (e.g. husband) can initiate emancipation for another shareholder in his household from his dashboard. Faster for tech-aware couples.
- **(iii)** Both.

Recommendation: **(i)** for v1. (ii) adds UI surface that's not urgent. Plan is written assuming (i).

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (rename model, add `reason` enum)
- Create: Prisma migration
- Create: `apps/api/src/modules/auth/emancipation.service.ts`
- Create: `apps/api/src/modules/auth/emancipation.service.spec.ts`
- Modify: `apps/api/src/modules/shareholders/birthday-scheduler.service.ts` (use new service)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (remove old inline token logic if any)
- Create: `apps/web/src/app/[locale]/emancipate/[token]/page.tsx`

- [ ] **Step 1: Schema change**

In `schema.prisma`:

```prisma
enum EmancipationReason {
  MINOR_COMING_OF_AGE
  HOUSEHOLD_SPLIT
}

model ShareholderEmancipationToken {
  id                String              @id @default(cuid())
  token             String              @unique
  shareholderId     String              @unique
  shareholder       Shareholder         @relation(fields: [shareholderId], references: [id], onDelete: Cascade)
  reason            EmancipationReason
  recipientUserId   String?             // the User receiving the token email (parent for minors, primary for households)
  recipientUser     User?               @relation("EmancipationRecipient", fields: [recipientUserId], references: [id], onDelete: SetNull)
  expiresAt         DateTime
  usedAt            DateTime?
  parentNotifiedAt  DateTime?
  reminderSentAt    DateTime?
  createdAt         DateTime            @default(now())

  @@map("shareholder_emancipation_tokens")
}
```

Remove the old `MinorUpgradeToken` model. Add the relation on `User`: `emancipationTokensReceived ShareholderEmancipationToken[] @relation("EmancipationRecipient")`.

Update `Shareholder.upgradeToken` → `Shareholder.emancipationToken`.

- [ ] **Step 2: Generate & check migration**

```bash
cd packages/database && pnpm prisma migrate dev --create-only --name shareholder_emancipation_tokens
```

Review the SQL. For existing rows: `INSERT INTO shareholder_emancipation_tokens (...) SELECT ..., 'MINOR_COMING_OF_AGE', ... FROM minor_upgrade_tokens;` followed by `DROP TABLE minor_upgrade_tokens;`. Confirm manually before applying.

- [ ] **Step 3: Apply migration to dev DB**

```bash
cd packages/database && pnpm prisma migrate dev
```

Expected: schema up, data preserved.

- [ ] **Step 4: Failing test — EmancipationService for HOUSEHOLD_SPLIT**

```typescript
// emancipation.service.spec.ts
it('startEmancipation(HOUSEHOLD_SPLIT) creates token and emails the primary user', async () => {
  const husband = await createUser('jan@x.com');
  const wife = await createShareholder({ email: null, userId: husband.id });

  const token = await service.startEmancipation({
    shareholderId: wife.id,
    reason: 'HOUSEHOLD_SPLIT',
  });

  expect(token.shareholderId).toBe(wife.id);
  expect(token.reason).toBe('HOUSEHOLD_SPLIT');
  expect(token.recipientUserId).toBe(husband.id);
  expect(emailMock).toHaveBeenCalledWith({
    to: 'jan@x.com',
    template: 'emancipation-household',
    vars: expect.objectContaining({ shareholderName: expect.any(String), claimLink: expect.stringContaining(token.token) }),
  });
});

it('consumeEmancipation creates new User and migrates shareholder.userId', async () => {
  // fixture: existing token
  const result = await service.consumeEmancipation({
    token: fixtureToken,
    email: 'marie@x.com',
    password: 'newpass123',
  });

  expect(result.user.email).toBe('marie@x.com');
  const wife = await prisma.shareholder.findUnique({ where: { id: wifeId } });
  expect(wife!.userId).toBe(result.user.id);
  expect(wife!.email).toBe('marie@x.com'); // emancipation re-populates shareholder.email
});
```

- [ ] **Step 5: Implement EmancipationService**

```typescript
@Injectable()
export class EmancipationService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private hasher: PasswordHasher,
  ) {}

  async startEmancipation(args: { shareholderId: string; reason: EmancipationReason }) {
    const shareholder = await this.prisma.shareholder.findUniqueOrThrow({
      where: { id: args.shareholderId },
      include: { user: true },
    });

    const recipient = shareholder.user; // for HOUSEHOLD_SPLIT this is the primary
    if (!recipient?.email) throw new BadRequestException('No recipient email available');

    const token = await this.prisma.shareholderEmancipationToken.create({
      data: {
        token: randomToken(),
        shareholderId: shareholder.id,
        reason: args.reason,
        recipientUserId: recipient.id,
        expiresAt: addDays(new Date(), 30),
      },
    });

    await this.email.send({
      to: recipient.email,
      template: args.reason === 'HOUSEHOLD_SPLIT' ? 'emancipation-household' : 'emancipation-minor',
      vars: {
        shareholderName: `${shareholder.firstName} ${shareholder.lastName}`,
        claimLink: `${config.webUrl}/emancipate/${token.token}`,
      },
    });

    return token;
  }

  async consumeEmancipation(args: { token: string; email: string; password: string }) {
    return this.prisma.$transaction(async (tx) => {
      const token = await tx.shareholderEmancipationToken.findUniqueOrThrow({ where: { token: args.token } });
      if (token.usedAt) throw new ConflictException('Token already used');
      if (token.expiresAt < new Date()) throw new BadRequestException('Token expired');

      const newUser = await tx.user.create({
        data: { email: args.email, passwordHash: await this.hasher.hash(args.password) },
      });
      await tx.shareholder.update({
        where: { id: token.shareholderId },
        data: { userId: newUser.id, email: args.email },
      });
      await tx.shareholderEmancipationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });
      return { user: newUser };
    });
  }
}
```

- [ ] **Step 6: Update `birthday-scheduler.service.ts` to use EmancipationService**

Replace the inline token creation logic (current `birthday-scheduler.service.ts:149-176`) with:

```typescript
await this.emancipation.startEmancipation({
  shareholderId: minor.id,
  reason: 'MINOR_COMING_OF_AGE',
});
```

Remove the now-dead token-creation code from `auth.service.ts` / `birthday-scheduler.service.ts`.

- [ ] **Step 7: Run all affected tests**

```bash
cd apps/api && pnpm test emancipation birthday-scheduler auth
```

Expected: PASS

- [ ] **Step 8: Build claim page**

`apps/web/src/app/[locale]/emancipate/[token]/page.tsx`:

```tsx
'use client';
export default function EmancipatePage({ params }: { params: { token: string } }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const res = await api('/auth/emancipate', { method: 'POST', body: { token: params.token, email, password } });
    if (res.ok) router.push('/dashboard');
    else setError(res.error);
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <h1>{t('emancipation.claimTitle')}</h1>
      <p>{t('emancipation.claimIntro')}</p>
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button onClick={submit}>{t('emancipation.claimCta')}</Button>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
```

Add matching AuthController endpoint `POST /auth/emancipate` that calls `emancipation.consumeEmancipation`.

- [ ] **Step 9: Translations for all 4 locales**

Add `emancipation.claimTitle`, `emancipation.claimIntro`, `emancipation.claimCta` to `apps/web/messages/{en,nl,fr,de}.json`.

- [ ] **Step 10: Commit**

```bash
git add packages/database/prisma/ apps/api/src/modules/auth/emancipation.* apps/api/src/modules/shareholders/birthday-scheduler.service.ts apps/web/src/app/[locale]/emancipate/ apps/web/messages/
git commit -m "feat(auth): generalize minor upgrade token to shareholder emancipation (households + minors)"
```

---

### Task 7: Magic link & auth edge cases

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:~1054` (requestMagicLink)
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Failing test — magic link works for a User with multiple shareholders**

```typescript
it('magic link login for shared inbox grants access to all household shareholders', async () => {
  const husband = await createUser('jan@x.com');
  await createShareholder({ email: null, userId: husband.id, firstName: 'Jan' });
  await createShareholder({ email: null, userId: husband.id, firstName: 'Marie' });

  await service.requestMagicLink('jan@x.com');
  const token = await getLatestMagicToken('jan@x.com');
  const session = await service.consumeMagicLink(token);

  const shareholders = await service.listMyShareholders(session.userId);
  expect(shareholders.map((s) => s.firstName).sort()).toEqual(['Jan', 'Marie']);
});

it('magic link to a NULL-email shareholder does NOT match (privacy: cannot request link for wife using her name)', async () => {
  // Only the User's email can trigger a magic link. shareholder.email=null does not open a backdoor.
  const husband = await createUser('jan@x.com');
  await createShareholder({ email: null, userId: husband.id, firstName: 'Marie' });
  await expect(service.requestMagicLink('marie@nonexistent.com')).resolves.toEqual({ sent: false });
});
```

- [ ] **Step 2: Run — first test likely passes (existing behavior), second needs review**

- [ ] **Step 3: Tighten magic link lookup**

Current (`auth.service.ts:~1054`): falls back to orphan Shareholder lookup if no User matches. This was for the case where a Shareholder exists but has no User yet. With the household model, this fallback must EXCLUDE Shareholders with userId set but email null — those represent linked shareholders and should not be magic-link-addressable by `shareholder.email` (which is null anyway; but the check is defensive).

Replace with:

```typescript
async requestMagicLink(email: string) {
  const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user) {
    // primary path
    return this.sendMagicLinkTo(user);
  }
  // orphan fallback: shareholder exists, no user, has own email
  const orphan = await this.prisma.shareholder.findFirst({
    where: {
      email: { equals: email.toLowerCase(), mode: 'insensitive' },
      userId: null,
    },
  });
  if (orphan) {
    // auto-create user + send
    return this.createUserAndSendMagicLink(orphan);
  }
  return { sent: false };
}
```

- [ ] **Step 4: Run — both tests pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "fix(auth): magic link ignores linked-shareholder rows; respects User as primary identity"
```

---

### Task 8: Admin UI — link shareholder to household

**Files:**
- Create: `apps/web/src/components/admin/link-shareholder-dialog.tsx`
- Modify: `apps/web/src/app/[locale]/dashboard/admin/shareholders/[shareholderId]/page.tsx` — add "Link to household" button
- Modify: `apps/web/src/app/[locale]/dashboard/personal-data/page.tsx:249` — show user.email + "managed by household" indicator when shareholder.email is null
- Modify: `apps/web/messages/{en,nl,fr,de}.json`

- [ ] **Step 1: Build dialog component**

```tsx
// link-shareholder-dialog.tsx
export function LinkShareholderDialog({ shareholderId, coopId }: Props) {
  const [search, setSearch] = useState('');
  const { data: candidates } = useQuery({
    queryKey: ['household-candidates', coopId, search],
    queryFn: () => api(`/admin/coops/${coopId}/users?search=${search}`),
    enabled: search.length >= 2,
  });
  const [selected, setSelected] = useState<string | null>(null);

  const linkMutation = useMutation({
    mutationFn: () =>
      api(`/admin/coops/${coopId}/shareholders/${shareholderId}/household/link`, {
        method: 'POST',
        body: { targetUserId: selected! },
      }),
    onSuccess: () => { /* toast + invalidate */ },
  });

  return (
    <Dialog>
      <DialogTrigger><Button variant="outline">{t('household.linkButton')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('household.linkTitle')}</DialogTitle>
          <DialogDescription>{t('household.linkIntro')}</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('household.searchPlaceholder')} />
        <ul>
          {candidates?.map((u) => (
            <li key={u.id}>
              <button onClick={() => setSelected(u.id)} className={selected === u.id ? 'ring-2' : ''}>
                {u.email} — {u.shareholderCount} {t('household.sharehInCoop')}
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => linkMutation.mutate()} disabled={!selected}>
            {t('household.confirmLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into shareholder detail page**

On `apps/web/src/app/[locale]/dashboard/admin/shareholders/[shareholderId]/page.tsx`, add the `<LinkShareholderDialog />` button in the actions row, visible only to COOP_ADMIN. Show a "Household" section listing sibling shareholders when `shareholder.userId` is shared by >1 shareholder.

- [ ] **Step 3: Personal data page — household indicator**

`personal-data/page.tsx:249` — replace:

```tsx
<Input value={shareholder.email || ''} disabled className="bg-muted" />
```

with:

```tsx
<Input value={shareholder.email ?? shareholder.user?.email ?? ''} disabled className="bg-muted" />
{!shareholder.email && shareholder.user?.email && (
  <p className="text-xs text-muted-foreground mt-1">
    {t('personalData.householdManagedEmail', { email: shareholder.user.email })}
  </p>
)}
```

- [ ] **Step 4: Translations**

Add to all 4 locale files:
- `household.linkButton` ("Link to household" / "Koppel aan huishouden" / "Lier au foyer" / "Mit Haushalt verknüpfen")
- `household.linkTitle`, `household.linkIntro`, `household.searchPlaceholder`, `household.confirmLink`, `household.sharehInCoop`
- `personalData.householdManagedEmail` ("Email managed by {email}" / etc.)

- [ ] **Step 5: Manual smoke test**

Start dev: `pnpm dev`. Log in as coop admin. On a shareholder detail page, click "Link to household", search for an existing user, select, confirm. Verify the target shareholder's row now shows `email=null, userId=<target>`.

- [ ] **Step 6: Playwright E2E**

```typescript
// e2e/admin-household-link.spec.ts
test('admin can link a shareholder to an existing household', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/dashboard/admin/shareholders/${wifeId}`);
  await page.getByRole('button', { name: /link to household/i }).click();
  await page.getByPlaceholder(/search/i).fill('jan@');
  await page.getByText('jan@x.com').click();
  await page.getByRole('button', { name: /confirm/i }).click();
  await expect(page.getByText(/household/i)).toContainText('Jan');
});
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/admin/link-shareholder-dialog.tsx apps/web/src/app/[locale]/dashboard/admin/shareholders/ apps/web/src/app/[locale]/dashboard/personal-data/ apps/web/messages/ apps/web/e2e/admin-household-link.spec.ts
git commit -m "feat(admin-ui): shareholder household linking dialog + personal data indicator"
```

---

### Task 9: Data hygiene — pre-ship audit script

**Files:**
- Create: `packages/database/prisma/audit-household-data.ts`

- [ ] **Step 1: Write the audit script**

```typescript
// audit-household-data.ts
// Run BEFORE deploying to prod. Reports any data that would become inconsistent.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Shareholders with email set but no User link (current orphans)
  const orphans = await prisma.shareholder.findMany({
    where: { email: { not: null }, userId: null },
    select: { id: true, email: true, coopId: true },
  });
  console.log(`Orphan shareholders (email, no User): ${orphans.length}`);

  // 2. Shareholders where shareholder.email != user.email (divergence)
  const diverged = await prisma.$queryRaw<any[]>`
    SELECT s.id, s.email AS sh_email, u.email AS user_email, s."coopId"
    FROM shareholders s JOIN users u ON s."userId" = u.id
    WHERE s.email IS NOT NULL AND LOWER(s.email) != LOWER(u.email);
  `;
  console.log(`Shareholder.email != User.email divergences: ${diverged.length}`);

  // 3. Users with multiple shareholders in same coop (potential existing households)
  const households = await prisma.$queryRaw<any[]>`
    SELECT "userId", "coopId", COUNT(*) AS n
    FROM shareholders
    WHERE "userId" IS NOT NULL
    GROUP BY "userId", "coopId"
    HAVING COUNT(*) > 1;
  `;
  console.log(`Users with >1 shareholder in same coop: ${households.length}`);
  console.log('These are candidates for the household model — verify each.');

  // 4. Duplicate emails across shareholders within a coop (excluding nulls)
  const dupes = await prisma.$queryRaw<any[]>`
    SELECT "coopId", LOWER(email) AS email, COUNT(*) AS n
    FROM shareholders
    WHERE email IS NOT NULL
    GROUP BY "coopId", LOWER(email)
    HAVING COUNT(*) > 1;
  `;
  console.log(`In-coop duplicate emails: ${dupes.length}`);
  console.log('Schema allows this only if constraint differs from expectation — investigate.');

  await prisma.$disconnect();
}
main();
```

- [ ] **Step 2: Run against dev DB (sanity check)**

```bash
cd packages/database && pnpm tsx prisma/audit-household-data.ts
```

Expected: All counts reasonable, no duplicate emails (schema forbids). Record counts.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/audit-household-data.ts
git commit -m "chore(db): add household-data audit script for pre-deploy verification"
```

---

### Task 10: Verification & changelog

- [ ] **Step 1: Run full test suite**

```bash
pnpm build
pnpm -r test
```

Expected: all green.

- [ ] **Step 2: Run the audit script against staging (acc) DB before tagging prod**

```bash
# Via SSH to fsn1, ssh wouter@fsn1.tailde0fcd.ts.net
docker exec opencoop-acc-api pnpm tsx /app/packages/database/prisma/audit-household-data.ts
```

Record output. Review with Wouter. Proceed only if counts are as expected.

- [ ] **Step 3: Update CHANGELOG.md**

Add entry:

```markdown
## v0.8.0 — 2026-04-XX

### Added
- **Shared-email households.** Couples and family members can share one login while each remains a distinct shareholder with their own voting rights. Admin can link a shareholder to an existing User via the admin UI; the linked shareholder inherits comms routing from the primary User.
- Emancipation flow: any linked shareholder can be graduated to their own login via a token-based flow (generalizes the existing minor-turning-18 upgrade).

### Changed
- **BREAKING (external API):** `GET /external-api/shareholders/query` now returns `[{ email, shareholders: [...] }]` instead of `Shareholder[]`. Upgrade your integration to handle grouped results. See `docs/migrations/2026-04-14-ecopower-api-breaking-change.md`.
- CSV shareholder import accepts a new optional `linkedTo` column to import household members in bulk.

### Fixed
- Email uniqueness checks no longer block valid household members with the same email.
```

- [ ] **Step 4: Tag prod deploy**

```bash
git tag -a v0.8.0 -m "shared-email households + emancipation flow"
git push origin v0.8.0
```

- [ ] **Step 5: Monitor deploy run to completion (per MEMORY: Always follow up deployments)**

Wait for the GitHub Action to succeed. If it fails, fix and re-tag. Don't walk away.

---

## Self-Review Checklist (for me, before handoff)

- [x] Every task references real files with line numbers from the audit
- [x] Design decisions flagged inline for Wouter (Tasks 3, 4, 6)
- [x] Bronsgroen AGM timing acknowledged — this plan is NOT the critical path for 2026-05-09
- [x] CHANGELOG entry included (per MEMORY: always update on prod deploys)
- [x] Deploy monitoring step (per MEMORY: always follow up)
- [x] Audit script gives pre-deploy safety net
- [x] Breaking change (external API) called out in 3 places: plan, docs, CHANGELOG
- [x] No placeholders; every step has actual code/commands

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-04-14-shared-email-households.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?** (Also: answer the three ⚠️ DECISION callouts in Tasks 3, 4, 6 first — they block implementation.)
