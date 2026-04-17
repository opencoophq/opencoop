# Household Headless Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins create a household between two shareholders even when neither has a `User` account yet, by rekeying the household link API on `shareholderId` and auto-creating a passwordless `User` when the target lacks one.

**Architecture:** The existing `HouseholdService` has two methods that currently require an existing `User`: `searchUsersInCoop` and `linkShareholderToUser`. Rewrite both to work off `shareholderId` instead. The new `linkShareholders` method, inside a single `$transaction`, creates a `User` from the target shareholder's email when needed, then links the source shareholder. No schema changes. No new UI surface — the existing admin dialog stays, only its types and payload shape change.

**Tech Stack:** NestJS 10, Prisma 6, Jest, Next.js 14 (React 18), TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-17-household-headless-linking-design.md`

---

## File Structure

**Modified files:**
- `apps/api/src/modules/shareholders/household.service.ts` — replace `searchUsersInCoop` with `searchHouseholdCandidates`; replace `linkShareholderToUser` with `linkShareholders` (adds auto-create-user branch)
- `apps/api/src/modules/shareholders/household.service.spec.ts` — update existing tests for new signatures; add cases for auto-create path and grouping
- `apps/api/src/modules/shareholders/household.controller.ts` — update both route handlers to call the renamed methods and pass `shareholderId` (source) into search
- `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts` — rename `targetUserId` → `targetShareholderId`
- `apps/web/src/components/admin/link-shareholder-dialog.tsx` — rename `HouseholdUser` → `HouseholdCandidate`, send `targetShareholderId` in POST body

**No new files.** Everything fits inside the existing module boundary.

---

## Task 1: Rename DTO field `targetUserId` → `targetShareholderId`

The DTO and its lone consumer (the controller) get the field rename. No tests on the DTO itself; the rename will be exercised by the service-layer tests in later tasks.

**Files:**
- Modify: `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts`
- Modify: `apps/api/src/modules/shareholders/household.controller.ts:39` (the single consumer — will be replaced more broadly in Task 4)

- [ ] **Step 1: Update the DTO**

Replace the contents of `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts` with:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkShareholderDto {
  @ApiProperty({
    description: 'ID of the target Shareholder to link to (the household anchor). If the target has no User yet, the backend will auto-create one.',
    example: 'clx...abc',
  })
  @IsString()
  @IsNotEmpty()
  targetShareholderId!: string;
}
```

- [ ] **Step 2: Patch the controller's single reference so the app still compiles**

In `apps/api/src/modules/shareholders/household.controller.ts`, change the `link` handler's body so it stops referencing the old field. Replace lines 37-40:

```typescript
    return this.household.linkShareholderToUser({
      coopId,
      shareholderId,
      targetUserId: dto.targetUserId,
      actorUserId: user.id,
    });
```

with a temporary bridge that keeps the existing service method working under the new DTO field name (full replacement happens in Task 4):

```typescript
    return this.household.linkShareholderToUser({
      coopId,
      shareholderId,
      targetUserId: dto.targetShareholderId, // TEMP: bridged in Task 4 when linkShareholders lands
      actorUserId: user.id,
    });
```

- [ ] **Step 3: Typecheck the API package**

Run:

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: clean exit (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts apps/api/src/modules/shareholders/household.controller.ts
git commit -m "refactor(household): rename DTO field targetUserId → targetShareholderId"
```

---

## Task 2: Rewrite search as `searchHouseholdCandidates`

Replace the User-centric search with a Shareholder-centric one. The method accepts the source shareholder id (to exclude it from results), returns `HouseholdCandidate[]`, and groups user-backed shareholders by `userId` while keeping userless shareholders as singletons.

**Files:**
- Modify: `apps/api/src/modules/shareholders/household.service.ts` (`searchUsersInCoop` → `searchHouseholdCandidates`)
- Modify: `apps/api/src/modules/shareholders/household.service.spec.ts` (new `describe` block, replacing no existing tests since the current spec has no search tests)

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/modules/shareholders/household.service.spec.ts`, inside the top-level `describe('HouseholdService', ...)` block (alongside the other `describe` blocks, before the closing brace):

```typescript
describe('searchHouseholdCandidates', () => {
  const sourceId = 'source-shareholder-id';

  it('returns [] when search is shorter than 2 characters', async () => {
    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'a');
    expect(result).toEqual([]);
    expect(prismaService.shareholder.findMany).not.toHaveBeenCalled();
  });

  it('returns a userless shareholder matched by shareholder.email', async () => {
    const jan = {
      id: 'jan-id',
      firstName: 'Jan',
      lastName: 'Stevens',
      email: 'jeanstevens2@telenet.be',
      userId: null,
      user: null,
      companyName: null,
      createdAt: new Date('2024-01-01'),
    };
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([jan]);

    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'jeanstev');

    expect(result).toEqual([
      {
        shareholderId: 'jan-id',
        email: 'jeanstevens2@telenet.be',
        fullName: 'Jan Stevens',
        shareholderCount: 1,
      },
    ]);
  });

  it('returns a user-backed shareholder matched by user.email', async () => {
    const row = {
      id: 'sh-1',
      firstName: 'Alice',
      lastName: 'Dupont',
      email: null,
      userId: 'user-1',
      user: { id: 'user-1', email: 'alice@x.com' },
      companyName: null,
      createdAt: new Date('2024-01-01'),
    };
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);

    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'alice');

    expect(result).toEqual([
      {
        shareholderId: 'sh-1',
        email: 'alice@x.com',
        fullName: 'Alice Dupont',
        shareholderCount: 1,
      },
    ]);
  });

  it('collapses multiple shareholders sharing a userId into one candidate with shareholderCount = group size', async () => {
    const anchor = {
      id: 'sh-anchor',
      firstName: 'Bob',
      lastName: 'Martin',
      email: null,
      userId: 'user-2',
      user: { id: 'user-2', email: 'bob@x.com' },
      companyName: null,
      createdAt: new Date('2024-01-01'),
    };
    const sibling = {
      id: 'sh-sibling',
      firstName: 'Clara',
      lastName: 'Martin',
      email: null,
      userId: 'user-2',
      user: { id: 'user-2', email: 'bob@x.com' },
      companyName: null,
      createdAt: new Date('2024-02-01'),
    };
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([anchor, sibling]);

    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'bob');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      shareholderId: 'sh-anchor', // earliest createdAt in the group
      email: 'bob@x.com',
      fullName: 'Bob Martin',
      shareholderCount: 2,
    });
  });

  it('excludes the source shareholder from the query', async () => {
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([]);

    await service.searchHouseholdCandidates(coop1.id, sourceId, 'anything');

    const call = (prismaService.shareholder.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.id).toEqual({ not: sourceId });
    expect(call.where.coopId).toBe(coop1.id);
  });

  it('uses companyName as fullName for COMPANY-type shareholders', async () => {
    const row = {
      id: 'sh-co',
      firstName: null,
      lastName: null,
      email: 'contact@bigco.be',
      userId: null,
      user: null,
      companyName: 'BigCo NV',
      createdAt: new Date('2024-01-01'),
    };
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);

    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'bigco');

    expect(result[0].fullName).toBe('BigCo NV');
  });

  it('sorts candidates by createdAt ascending and trims to 10 results', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `sh-${i}`,
      firstName: 'User',
      lastName: `${i}`,
      email: `user${i}@x.com`,
      userId: null,
      user: null,
      companyName: null,
      createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
    }));
    (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce(rows);

    const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'user');

    expect(result).toHaveLength(10);
    expect(result[0].shareholderId).toBe('sh-0');
    expect(result[9].shareholderId).toBe('sh-9');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test -- household.service
```

Expected: all 7 new tests FAIL (method doesn't exist).

- [ ] **Step 3: Implement `searchHouseholdCandidates`**

In `apps/api/src/modules/shareholders/household.service.ts`, **replace** the existing `searchUsersInCoop` method (lines 81-118, the method starting with the doc comment "Search for users who have at least one shareholder in this coop.") with:

```typescript
  /**
   * Search for household-link candidates in this coop by email.
   * Returns one candidate per distinct "household anchor":
   * - user-backed shareholders collapse by userId (shareholderCount = group size)
   * - userless shareholders are returned individually (shareholderCount = 1)
   *
   * Excludes the source shareholder. Excludes shareholders with no resolvable email
   * (neither shareholder.email nor user.email is set).
   */
  async searchHouseholdCandidates(
    coopId: string,
    sourceShareholderId: string,
    search: string,
  ): Promise<
    Array<{
      shareholderId: string;
      email: string;
      fullName: string;
      shareholderCount: number;
    }>
  > {
    if (!search || search.length < 2) return [];

    const rows = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        id: { not: sourceShareholderId },
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
        userId: true,
        user: { select: { id: true, email: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const displayName = (row: (typeof rows)[number]): string => {
      if (row.firstName && row.lastName) return `${row.firstName} ${row.lastName}`;
      if (row.companyName) return row.companyName;
      return row.email ?? row.user?.email ?? '';
    };

    const byUserId = new Map<string, typeof rows>();
    const userless: typeof rows = [];
    for (const row of rows) {
      if (row.userId) {
        const group = byUserId.get(row.userId) ?? [];
        group.push(row);
        byUserId.set(row.userId, group);
      } else {
        userless.push(row);
      }
    }

    const candidates: Array<{
      shareholderId: string;
      email: string;
      fullName: string;
      shareholderCount: number;
      anchorCreatedAt: Date;
    }> = [];

    for (const group of byUserId.values()) {
      const anchor = group[0]; // earliest createdAt — rows are pre-sorted ASC
      const email = anchor.user?.email ?? anchor.email;
      if (!email) continue;
      candidates.push({
        shareholderId: anchor.id,
        email,
        fullName: displayName(anchor),
        shareholderCount: group.length,
        anchorCreatedAt: anchor.createdAt,
      });
    }
    for (const row of userless) {
      const email = row.email;
      if (!email) continue;
      candidates.push({
        shareholderId: row.id,
        email,
        fullName: displayName(row),
        shareholderCount: 1,
        anchorCreatedAt: row.createdAt,
      });
    }

    candidates.sort((a, b) => a.anchorCreatedAt.getTime() - b.anchorCreatedAt.getTime());

    return candidates.slice(0, 10).map(({ anchorCreatedAt: _unused, ...rest }) => rest);
  }
```

Note: the old `searchUsersInCoop` is **deleted** in this step. If something outside tests still references it, the typechecker will complain in Step 5.

- [ ] **Step 4: Run the new tests**

```bash
cd apps/api && pnpm test -- household.service
```

Expected: all 7 new `searchHouseholdCandidates` tests PASS. Existing tests (for `linkShareholderToUser`, `unlinkShareholder`, `listShareholdersForUser`) still pass — they don't depend on the search method.

- [ ] **Step 5: Typecheck the API package**

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: a compile error in `household.controller.ts` at the `@Get('search-users')` handler, which still calls `this.household.searchUsersInCoop(...)`. That's expected — it will be fixed in Task 4. Proceed without committing if the only error is that one line.

If any other call site references `searchUsersInCoop`, stop and search:

```bash
rg "searchUsersInCoop" apps/
```

Expected: only `household.controller.ts:25`. Other hits → stop and reassess.

- [ ] **Step 6: Commit**

Stage everything except the broken controller line (which we'll fix in Task 4):

```bash
git add apps/api/src/modules/shareholders/household.service.ts apps/api/src/modules/shareholders/household.service.spec.ts
git commit -m "feat(household): shareholder-keyed candidate search with grouping"
```

The controller has a known compile error at `searchUsersInCoop` — that's fine; Task 4 fixes it.

---

## Task 3: Rewrite link as `linkShareholders` with auto-create

Replace `linkShareholderToUser` with `linkShareholders({ coopId, shareholderId, targetShareholderId, actorUserId })`. The new method, inside one `$transaction`, ensures the target has a User (creating a passwordless one from the target's email if needed) and then links the source.

**Files:**
- Modify: `apps/api/src/modules/shareholders/household.service.ts`
- Modify: `apps/api/src/modules/shareholders/household.service.spec.ts` (rewrite the `describe('linkShareholderToUser', ...)` block as `describe('linkShareholders', ...)` with updated mocks and added auto-create cases)

- [ ] **Step 1: Update the Prisma mock to include `user` operations**

In `apps/api/src/modules/shareholders/household.service.spec.ts`, find the `beforeEach` block (around line 37). Replace the `prismaService` assignment with:

```typescript
    prismaService = {
      shareholder: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prismaService)),
    } as unknown as PrismaService;
```

- [ ] **Step 2: Replace the existing `describe('linkShareholderToUser', ...)` block entirely**

In the same spec file, locate `describe('linkShareholderToUser', () => {` (around line 61). **Delete the entire block** through its closing `});` (around line 189 — ends just before `describe('unlinkShareholder', ...)`. Replace it with:

```typescript
  describe('linkShareholders', () => {
    // Source: the shareholder the admin is currently viewing
    const source = {
      id: 'source-shareholder-id',
      coopId: coop1.id,
      userId: null as string | null,
      email: 'laurette@telenet.be',
    };

    // Target (user-backed): Jan with an existing User account
    const targetWithUser = {
      id: 'jan-shareholder-id',
      coopId: coop1.id,
      userId: jan.id,
      email: null as string | null,
    };

    // Target (userless): Jan as a pure imported shareholder
    const targetWithoutUser = {
      id: 'jan-shareholder-id',
      coopId: coop1.id,
      userId: null as string | null,
      email: 'jeanstevens2@telenet.be',
    };

    it('links source to target.userId when target already has a User (existing-user path)', async () => {
      const updated = { ...source, userId: jan.id, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)          // load source
        .mockResolvedValueOnce(targetWithUser); // load target
      (prismaService.shareholder.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithUser.id,
        actorUserId: adminUser.id,
      });

      expect(result.userId).toBe(jan.id);
      expect(result.email).toBeNull();
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('auto-creates a passwordless User from target.email when target has no User, then links source', async () => {
      const newUser = { id: 'new-user-id', email: targetWithoutUser.email };
      const updatedSource = { ...source, userId: newUser.id, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(null); // no pre-existing collision
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce(newUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: newUser.id, email: null }) // target update
        .mockResolvedValueOnce(updatedSource);                                              // source update

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'jeanstevens2@telenet.be',
          passwordHash: null,
          role: 'SHAREHOLDER',
        },
      });

      // Target shareholder mutated: userId set, email cleared
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: targetWithoutUser.id },
        data: { userId: newUser.id, email: null },
      });

      // Source shareholder linked to the new user
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { userId: newUser.id, email: null },
      });

      expect(result.userId).toBe(newUser.id);
    });

    it('reuses an existing User with the same email instead of creating a duplicate (defensive)', async () => {
      const existingUser = { id: 'pre-existing-user-id', email: targetWithoutUser.email };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(existingUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: existingUser.id, email: null })
        .mockResolvedValueOnce({ ...source, userId: existingUser.id, email: null });

      await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.user.create).not.toHaveBeenCalled();
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { userId: existingUser.id, email: null },
      });
    });

    it('rejects self-link (source === target)', async () => {
      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: source.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.shareholder.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when source shareholder is not in the coop', async () => {
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: 'unknown',
          targetShareholderId: targetWithUser.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when target shareholder is not in the coop', async () => {
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(null);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: 'unknown',
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns source unchanged when already linked to target.userId (idempotent)', async () => {
      const alreadyLinked = { ...source, userId: jan.id };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(alreadyLinked)
        .mockResolvedValueOnce(targetWithUser);

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithUser.id,
        actorUserId: adminUser.id,
      });

      expect(result).toBe(alreadyLinked);
      expect(prismaService.shareholder.update).not.toHaveBeenCalled();
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('throws when source is already linked to a different user', async () => {
      const linkedElsewhere = { ...source, userId: 'other-user-id' };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(linkedElsewhere)
        .mockResolvedValueOnce(targetWithUser);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: targetWithUser.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(/emancipate first/i);
    });

    it('rejects when target has no email (cannot auto-create anchor)', async () => {
      const targetNoEmail = { ...targetWithoutUser, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetNoEmail);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: targetNoEmail.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('writes audit rows for source link, target link, and User creation in the auto-create path', async () => {
      const newUser = { id: 'new-user-id', email: targetWithoutUser.email };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce(newUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: newUser.id, email: null })
        .mockResolvedValueOnce({ ...source, userId: newUser.id, email: null });

      await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      const auditCalls = (prismaService.auditLog.create as jest.Mock).mock.calls.map((c) => c[0].data);
      const actions = auditCalls.map((d) => d.action);
      expect(actions).toContain('CREATE_USER_FROM_SHAREHOLDER');
      expect(actions.filter((a) => a === 'LINK_SHAREHOLDER_TO_HOUSEHOLD')).toHaveLength(2);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && pnpm test -- household.service
```

Expected: the 10 new `linkShareholders` tests FAIL (method doesn't exist). The `unlinkShareholder` and `listShareholdersForUser` tests still pass.

- [ ] **Step 4: Implement `linkShareholders` and remove `linkShareholderToUser`**

In `apps/api/src/modules/shareholders/household.service.ts`, **replace** the existing `linkShareholderToUser` method (lines 15-72, from its signature to its closing brace) with:

```typescript
  async linkShareholders(args: {
    coopId: string;
    shareholderId: string;      // source shareholder (the one being linked into the household)
    targetShareholderId: string; // household anchor shareholder
    actorUserId: string;
  }) {
    if (args.shareholderId === args.targetShareholderId) {
      throw new BadRequestException('Cannot link a shareholder to itself');
    }

    const source = await this.prisma.shareholder.findFirst({
      where: { id: args.shareholderId, coopId: args.coopId },
    });
    if (!source) {
      throw new NotFoundException('Shareholder not found');
    }

    const target = await this.prisma.shareholder.findFirst({
      where: { id: args.targetShareholderId, coopId: args.coopId },
    });
    if (!target) {
      throw new NotFoundException('Target shareholder not found in this cooperative');
    }

    // If source is already linked somewhere, either it's idempotent (same household) or rejected
    if (source.userId !== null) {
      if (target.userId !== null && source.userId === target.userId) {
        return source; // already in same household, no-op
      }
      throw new BadRequestException(
        'Shareholder is already linked to a different user. Emancipate first before re-linking.',
      );
    }

    // Guard: target must have something to anchor a household on
    if (!target.userId && !target.email) {
      throw new BadRequestException(
        'Target shareholder has no email or user account to anchor a household on.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let anchorUserId = target.userId;

      // Auto-create a passwordless User from the target shareholder if needed
      if (!anchorUserId) {
        const email = target.email!.toLowerCase(); // guarded above
        const existing = await tx.user.findUnique({ where: { email } });
        let anchorUser = existing;
        if (!anchorUser) {
          anchorUser = await tx.user.create({
            data: {
              email,
              passwordHash: null,
              role: 'SHAREHOLDER',
            },
          });
          await tx.auditLog.create({
            data: {
              coopId: args.coopId,
              entity: 'User',
              entityId: anchorUser.id,
              action: 'CREATE_USER_FROM_SHAREHOLDER',
              actorId: args.actorUserId,
              changes: [
                { field: 'email', oldValue: null, newValue: anchorUser.email },
                { field: 'sourceShareholderId', oldValue: null, newValue: target.id },
              ] as unknown as Prisma.InputJsonValue,
            },
          });
        }
        anchorUserId = anchorUser.id;

        await tx.shareholder.update({
          where: { id: target.id },
          data: { userId: anchorUserId, email: null },
        });
        await tx.auditLog.create({
          data: {
            coopId: args.coopId,
            entity: 'Shareholder',
            entityId: target.id,
            action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
            actorId: args.actorUserId,
            changes: [
              { field: 'userId', oldValue: null, newValue: anchorUserId },
              { field: 'email', oldValue: target.email, newValue: null },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const updatedSource = await tx.shareholder.update({
        where: { id: source.id },
        data: { userId: anchorUserId, email: null },
      });
      await tx.auditLog.create({
        data: {
          coopId: args.coopId,
          entity: 'Shareholder',
          entityId: source.id,
          action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
          actorId: args.actorUserId,
          changes: [
            { field: 'userId', oldValue: source.userId, newValue: anchorUserId },
            { field: 'email', oldValue: source.email, newValue: null },
          ] as unknown as Prisma.InputJsonValue,
        },
      });

      return updatedSource;
    });
  }
```

- [ ] **Step 5: Run tests again**

```bash
cd apps/api && pnpm test -- household.service
```

Expected: all `linkShareholders` tests PASS. `unlinkShareholder` and `listShareholdersForUser` still pass. If the "returns source unchanged when already linked" test fails, check that the idempotent branch returns `source` (the original object) and not `updatedSource`.

- [ ] **Step 6: Typecheck**

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: one compile error in `household.controller.ts` where `this.household.linkShareholderToUser(...)` is still referenced. That gets fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/shareholders/household.service.ts apps/api/src/modules/shareholders/household.service.spec.ts
git commit -m "feat(household): auto-create passwordless user when target shareholder has none"
```

---

## Task 4: Wire up the controller

Point both route handlers at the renamed service methods. The URL paths stay the same (`GET …/household/search-users`, `POST …/household/link`) — no frontend route changes needed.

**Files:**
- Modify: `apps/api/src/modules/shareholders/household.controller.ts`

- [ ] **Step 1: Replace the controller contents**

Overwrite `apps/api/src/modules/shareholders/household.controller.ts` with:

```typescript
import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { HouseholdService } from './household.service';
import { LinkShareholderDto } from './dto/link-shareholder.dto';

@ApiTags('Shareholders')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/shareholders/:shareholderId/household')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('COOP_ADMIN', 'SYSTEM_ADMIN')
export class HouseholdController {
  constructor(private readonly household: HouseholdService) {}

  @Get('search-users')
  @ApiOperation({
    summary: 'Search household-link candidates in this coop by email (excludes the current shareholder)',
  })
  async searchCandidates(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Query('search') search: string,
  ) {
    return this.household.searchHouseholdCandidates(coopId, shareholderId, search ?? '');
  }

  @Post('link')
  @ApiOperation({
    summary:
      'Link a shareholder into a household. If the target shareholder has no user account yet, one is auto-created from their email.',
  })
  async link(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @Body() dto: LinkShareholderDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.household.linkShareholders({
      coopId,
      shareholderId,
      targetShareholderId: dto.targetShareholderId,
      actorUserId: user.id,
    });
  }

  @Post('emancipate')
  @ApiOperation({ summary: 'Unlink a shareholder from a shared household (emancipation)' })
  async emancipate(
    @Param('coopId') coopId: string,
    @Param('shareholderId') shareholderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.household.unlinkShareholder({
      coopId,
      shareholderId,
      actorUserId: user.id,
    });
  }
}
```

- [ ] **Step 2: Typecheck the API package end-to-end**

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: clean exit. No remaining references to `searchUsersInCoop` or `linkShareholderToUser`.

- [ ] **Step 3: Run the full API test suite to confirm nothing elsewhere regressed**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/shareholders/household.controller.ts
git commit -m "refactor(household): point controller at renamed service methods"
```

---

## Task 5: Update frontend dialog

Rename the candidate type and update the POST body. UI behavior is unchanged.

**Files:**
- Modify: `apps/web/src/components/admin/link-shareholder-dialog.tsx`

- [ ] **Step 1: Rewrite the dialog**

Replace the contents of `apps/web/src/components/admin/link-shareholder-dialog.tsx` with:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { Loader2, Check } from 'lucide-react';

interface HouseholdCandidate {
  shareholderId: string;
  email: string;
  fullName: string;
  shareholderCount: number;
}

interface LinkShareholderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coopId: string;
  shareholderId: string;
  onLinked: () => void;
}

export function LinkShareholderDialog({
  open,
  onOpenChange,
  coopId,
  shareholderId,
  onLinked,
}: LinkShareholderDialogProps) {
  const t = useTranslations();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<HouseholdCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<HouseholdCandidate | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setSelected(null);
      setError(null);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (search.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const data = await api<HouseholdCandidate[]>(
          `/admin/coops/${coopId}/shareholders/${shareholderId}/household/search-users?search=${encodeURIComponent(search)}`,
        );
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, coopId, shareholderId]);

  const handleLink = async () => {
    if (!selected) return;
    setLinking(true);
    setError(null);
    try {
      await api(
        `/admin/coops/${coopId}/shareholders/${shareholderId}/household/link`,
        { method: 'POST', body: { targetShareholderId: selected.shareholderId } },
      );
      onOpenChange(false);
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('household.linkTitle')}</DialogTitle>
          <DialogDescription>{t('household.linkIntro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Input
            placeholder={t('household.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
            autoFocus
          />

          {searching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('common.loading')}
            </div>
          )}

          {!searching && search.length >= 2 && results.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
          )}

          {results.length > 0 && (
            <div className="rounded-md border divide-y">
              {results.map((candidate) => (
                <button
                  key={candidate.shareholderId}
                  type="button"
                  onClick={() => setSelected(candidate)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center justify-between ${
                    selected?.shareholderId === candidate.shareholderId ? 'bg-muted' : ''
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{candidate.fullName}</span>
                    <span className="text-xs text-muted-foreground">{candidate.email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    {selected?.shareholderId === candidate.shareholderId && (
                      <Check className="h-3 w-3 text-green-600" />
                    )}
                    {t('household.resultMeta', { count: candidate.shareholderCount })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('household.cancel')}
          </Button>
          <Button onClick={handleLink} disabled={!selected || linking}>
            {linking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('household.confirmLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The three UI changes vs the old version:
1. `HouseholdUser` → `HouseholdCandidate`; fields are `shareholderId`, `email`, `fullName`, `shareholderCount`.
2. POST body is `{ targetShareholderId: selected.shareholderId }`.
3. Result rows now show `fullName` as primary text with email as secondary (nicer when multiple people share an email in the list).

- [ ] **Step 2: Typecheck the web package**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/link-shareholder-dialog.tsx
git commit -m "refactor(admin-ui): rekey link dialog on shareholderId, display fullName"
```

---

## Task 6: Manual smoke test on acc, then cut prod

No new automated E2E — the existing admin-household-link Playwright test (if present) plus Jest coverage is sufficient, and the core behavior is exercised in the service-layer tests.

- [ ] **Step 1: Push to main, let acc deploy**

```bash
git push origin main
```

Monitor the GitHub Actions run. Wait for green.

- [ ] **Step 2: On acc, create two test shareholders without User accounts**

Either via the admin UI (add shareholder, leave password flow un-triggered) or via SSH:

```bash
ssh wouter@fsn1.tailde0fcd.ts.net "docker exec opencoop-acc-postgres-1 psql -U opencoop -d opencoop -c \"SELECT id, \\\"firstName\\\", \\\"lastName\\\", email, \\\"userId\\\" FROM shareholders WHERE \\\"userId\\\" IS NULL AND email IS NOT NULL LIMIT 5;\""
```

Pick two shareholders from the result. Note their IDs and emails.

- [ ] **Step 3: Log into acc as a coop admin and link them**

- Navigate to the first shareholder's detail page.
- Click "Link to household" (existing button).
- Search for the second shareholder's email or name.
- Verify the dropdown shows them.
- Select, confirm.
- Dialog should close with no error.

- [ ] **Step 4: Verify DB state**

```bash
ssh wouter@fsn1.tailde0fcd.ts.net "docker exec opencoop-acc-postgres-1 psql -U opencoop -d opencoop -c \"SELECT s.id, s.\\\"firstName\\\", s.\\\"lastName\\\", s.email AS sh_email, s.\\\"userId\\\", u.email AS user_email, u.\\\"passwordHash\\\" IS NULL AS no_password FROM shareholders s LEFT JOIN users u ON u.id = s.\\\"userId\\\" WHERE s.id IN ('<id1>', '<id2>');\""
```

Expected:
- Both rows have the same `userId`
- Both rows have `sh_email = NULL`
- `user_email` matches the **target** shareholder's original email
- `no_password = t` (passwordless user)

- [ ] **Step 5: Verify audit rows**

```bash
ssh wouter@fsn1.tailde0fcd.ts.net "docker exec opencoop-acc-postgres-1 psql -U opencoop -d opencoop -c \"SELECT action, entity, \\\"entityId\\\" FROM audit_logs WHERE \\\"createdAt\\\" > NOW() - INTERVAL '5 minutes' ORDER BY \\\"createdAt\\\" DESC;\""
```

Expected three relevant rows for this action: one `CREATE_USER_FROM_SHAREHOLDER` on `User`, two `LINK_SHAREHOLDER_TO_HOUSEHOLD` on `Shareholder`.

- [ ] **Step 6: Update CHANGELOG.md**

Append under the next version heading (create it if missing — use `v0.8.1` unless another patch has landed):

```markdown
## v0.8.1 — 2026-04-XX

### Fixed
- Household linking now works when neither shareholder has a login yet. The admin can pick any shareholder in the coop as the household anchor; the system creates the backing account transparently.
```

- [ ] **Step 7: Commit changelog, tag prod, push**

```bash
git add CHANGELOG.md
git commit -m "chore: CHANGELOG for v0.8.1"
git tag -a v0.8.1 -m "fix(household): link works when neither shareholder has a user"
git push origin main v0.8.1
```

- [ ] **Step 8: Monitor prod deploy**

Watch the tag-triggered GitHub Actions run. Fix and re-tag if it fails.

- [ ] **Step 9: One-off: link Laurette → Jan on prod via the admin UI**

Once prod is green:
- Navigate to Laurette Beusen's shareholder detail page (coop-admin login).
- Click "Link to household".
- Search `jeanstev`, pick Jan Stevens (`jeanstevens2@telenet.be`).
- Confirm.
- Verify via the prod DB query from Step 4 that both Laurette and Jan now share a new `userId`, emails are null on shareholders, and the new User has no password.

---

## Self-Review

- **Spec coverage**: All spec requirements map to tasks:
  - Shareholder-keyed API → Task 1 (DTO), Task 2 (search), Task 3 (link), Task 4 (controller), Task 5 (frontend)
  - Auto-create passwordless User → Task 3
  - Clear `Shareholder.email` on both shareholders → Task 3 (existing behavior for source, new behavior for auto-created target)
  - Three audit rows → Task 3 (`CREATE_USER_FROM_SHAREHOLDER` + two `LINK_SHAREHOLDER_TO_HOUSEHOLD`)
  - Edge cases (self-link, no email, cross-coop, idempotent, already linked elsewhere, pre-existing User collision) → Task 3 tests + implementation
  - UX unchanged, dialog field/type rename only → Task 5
  - No schema changes → none of the tasks touch `schema.prisma`
  - One-off data fix for Laurette/Jean via UI → Task 6 Step 9
- **Placeholder scan**: none. No TBD/TODO/vague handlers. Every code block is complete.
- **Type consistency**:
  - `HouseholdCandidate` shape (`shareholderId`, `email`, `fullName`, `shareholderCount`) matches between service return (Task 2), API response, and frontend interface (Task 5).
  - DTO field `targetShareholderId` is consistent across Task 1 (DTO), Task 3 (service args), Task 4 (controller binding), Task 5 (frontend POST body).
  - Service method names `searchHouseholdCandidates` and `linkShareholders` are consistent between Tasks 2-4.
- **Known controller compile break window**: Tasks 2 and 3 each end with the controller temporarily referencing a deleted method. This is intentional to keep commits small and focused; Task 4 closes the break. The plan explicitly calls this out so the executor doesn't panic.
