# Audit History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add append-only audit logging for all data changes across Shareholder, User, and Coop entities.

**Architecture:** Service-level logging via a shared `AuditModule` with explicit `auditService.log()` calls at each update path. Generic `audit_logs` table stores entity, field-level diffs, and actor info. Frontend displays audit history on shareholder detail, coop settings, and a global system audit page.

**Tech Stack:** Prisma (schema + migration), NestJS (module/service/controller), Next.js (React pages), next-intl (i18n)

**Design doc:** `docs/plans/2026-03-04-audit-history-design.md`

---

### Task 1: Prisma Schema — Add AuditLog Model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add AuditLog model to schema**

Add at the end of the schema (before the closing of the file), after the `Subscription` model:

```prisma
// ============================================================================
// AUDIT LOGS
// ============================================================================

model AuditLog {
  id        String   @id @default(cuid())
  coopId    String?
  entity    String               // "Shareholder", "User", "Coop"
  entityId  String
  action    String               // "CREATE", "UPDATE", "DELETE"
  changes   Json                 // [{ field, oldValue, newValue }]
  actorId   String?
  ipAddress String?
  createdAt DateTime @default(now())

  coop      Coop?    @relation(fields: [coopId], references: [id])
  actor     User?    @relation(fields: [actorId], references: [id])

  @@index([entity, entityId])
  @@index([coopId])
  @@index([actorId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

Also add the reverse relations to existing models:
- `Coop` model: add `auditLogs AuditLog[]` in the Relations section (after `subscription`)
- `User` model: add `auditLogs AuditLog[]` in the Relations section (after `webAuthnCredentials`)

**Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Success, no errors

**Step 3: Create migration**

Run: `pnpm db:migrate --name add-audit-logs`
Expected: Migration created successfully

**Step 4: Commit**

```
git add packages/database/prisma/
git commit -m "feat: add AuditLog model to Prisma schema"
```

---

### Task 2: AuditModule — Service with log() and diff()

**Files:**
- Create: `apps/api/src/modules/audit/audit.module.ts`
- Create: `apps/api/src/modules/audit/audit.service.ts`
- Modify: `apps/api/src/app.module.ts` (import AuditModule)

**Step 1: Create audit.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'mfaSecret',
  'mfaRecoveryCodes',
  'nationalId',
  'smtpPass',
  'graphClientSecret',
]);

interface Change {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    coopId?: string;
    entity: string;
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    changes: Change[];
    actorId?: string;
    ipAddress?: string;
  }) {
    if (params.changes.length === 0 && params.action === 'UPDATE') return;

    const maskedChanges = params.changes.map((c) =>
      SENSITIVE_FIELDS.has(c.field)
        ? { field: c.field, oldValue: '***', newValue: '***' }
        : c,
    );

    await this.prisma.auditLog.create({
      data: {
        coopId: params.coopId ?? null,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        changes: maskedChanges,
        actorId: params.actorId ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  }

  /**
   * Diff two objects and return changed fields.
   * Only compares fields present in `newObj` (the update DTO).
   * Handles nested JSON objects (e.g., address) by comparing stringified values.
   */
  diff(
    oldObj: Record<string, unknown>,
    newObj: Record<string, unknown>,
  ): Change[] {
    const changes: Change[] = [];

    for (const key of Object.keys(newObj)) {
      if (newObj[key] === undefined) continue;

      const oldVal = oldObj[key];
      const newVal = newObj[key];

      // Handle JSON/object fields (e.g., address)
      if (typeof oldVal === 'object' && typeof newVal === 'object' && oldVal !== null && newVal !== null) {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({ field: key, oldValue: oldVal, newValue: newVal });
        }
        continue;
      }

      // Handle Date comparisons
      if (oldVal instanceof Date) {
        const newDate = newVal instanceof Date ? newVal : new Date(newVal as string);
        if (oldVal.getTime() !== newDate.getTime()) {
          changes.push({ field: key, oldValue: oldVal.toISOString(), newValue: newDate.toISOString() });
        }
        continue;
      }

      // Simple equality
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        changes.push({ field: key, oldValue: oldVal ?? null, newValue: newVal ?? null });
      }
    }

    return changes;
  }

  async findByEntity(
    entity: string,
    entityId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entity, entityId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where: { entity, entityId } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByCoop(
    coopId: string,
    params: { entity?: string; entityId?: string; page?: number; limit?: number } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { coopId };
    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAll(
    params: { coopId?: string; entity?: string; entityId?: string; actorId?: string; page?: number; limit?: number } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (params.coopId) where.coopId = params.coopId;
    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;
    if (params.actorId) where.actorId = params.actorId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
          coop: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
```

**Step 2: Create audit.module.ts**

```typescript
import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

Using `@Global()` so every module can inject `AuditService` without explicit imports.

**Step 3: Register in app.module.ts**

Add `AuditModule` to the imports array in `apps/api/src/app.module.ts`:

```typescript
import { AuditModule } from './modules/audit/audit.module';
// Add to imports array (after PrismaModule):
AuditModule,
```

**Step 4: Commit**

```
git add apps/api/src/modules/audit/ apps/api/src/app.module.ts
git commit -m "feat: add AuditModule with log/diff/query methods"
```

---

### Task 3: Instrument Shareholder Update Paths

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts`
- Modify: `apps/api/src/modules/shareholders/shareholder-actions.controller.ts`

**Step 1: Add audit logging to shareholders.service.ts**

Inject `AuditService` in the constructor:

```typescript
import { AuditService } from '../audit/audit.service';

constructor(
  private prisma: PrismaService,
  private auditService: AuditService,
) {}
```

In `create()` method, after the `prisma.shareholder.create()` call (before the return), add:

```typescript
await this.auditService.log({
  coopId,
  entity: 'Shareholder',
  entityId: created.id,
  action: 'CREATE',
  changes: [{ field: '_created', oldValue: null, newValue: dto.type }],
  actorId: actorId,
});
```

Note: `create()` method needs an `actorId` parameter added. The method signature becomes:
```typescript
async create(coopId: string, dto: CreateShareholderDto, actorId?: string)
```

In `update()` method, the `existing` record is already fetched via `this.findById(id, coopId)`. After the `prisma.shareholder.update()` call, add:

```typescript
const changes = this.auditService.diff(existing, dto);
if (changes.length > 0) {
  await this.auditService.log({
    coopId,
    entity: 'Shareholder',
    entityId: id,
    action: 'UPDATE',
    changes,
    actorId,
  });
}
```

The `update()` method signature becomes:
```typescript
async update(id: string, coopId: string, dto: UpdateShareholderDto, actorId?: string)
```

**Step 2: Add audit logging to shareholder-actions.controller.ts**

Inject `AuditService` in the constructor:

```typescript
import { AuditService } from '../audit/audit.service';

constructor(
  private prisma: PrismaService,
  private transactionsService: TransactionsService,
  private documentsService: DocumentsService,
  private auditService: AuditService,
) {}
```

In `updateBankDetails()`: Fetch old values before update, then log:

```typescript
async updateBankDetails(
  @Param('shareholderId') shareholderId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() dto: UpdateBankDetailsDto,
) {
  const shareholder = await this.verifyShareholder(shareholderId, user.id);

  const changes = this.auditService.diff(
    { bankIban: shareholder.bankIban, bankBic: shareholder.bankBic },
    { bankIban: dto.bankIban, bankBic: dto.bankBic || null },
  );

  const updated = await this.prisma.shareholder.update({
    where: { id: shareholderId },
    data: { bankIban: dto.bankIban, bankBic: dto.bankBic || null },
    select: { id: true, bankIban: true, bankBic: true },
  });

  if (changes.length > 0) {
    await this.auditService.log({
      coopId: shareholder.coopId,
      entity: 'Shareholder',
      entityId: shareholderId,
      action: 'UPDATE',
      changes,
      actorId: user.id,
    });
  }

  return updated;
}
```

In `updateProfile()`: Same pattern — capture old values, update, log diff:

```typescript
async updateProfile(
  @Param('shareholderId') shareholderId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() dto: UpdateProfileDto,
) {
  const shareholder = await this.verifyShareholder(shareholderId, user.id);

  const { address, birthDate, ...rest } = dto;
  const data: Record<string, unknown> = { ...rest };
  if (birthDate) data.birthDate = new Date(birthDate);
  if (address) data.address = address;

  const changes = this.auditService.diff(shareholder as Record<string, unknown>, data);

  const updated = await this.prisma.shareholder.update({
    where: { id: shareholderId },
    data,
  });

  if (changes.length > 0) {
    await this.auditService.log({
      coopId: shareholder.coopId,
      entity: 'Shareholder',
      entityId: shareholderId,
      action: 'UPDATE',
      changes,
      actorId: user.id,
    });
  }

  return updated;
}
```

**Step 3: Update callers of shareholders.service.create/update to pass actorId**

In `admin.controller.ts`:
- `createShareholder()`: pass `user.id` — requires adding `@CurrentUser() user: CurrentUserData` to the method
- `updateShareholder()`: pass `user.id` — requires adding `@CurrentUser() user: CurrentUserData` to the method

In `coops.service.ts` `publicRegister()`:
- `shareholdersService.create()`: no actorId (public registration, no authenticated user)

**Step 4: Commit**

```
git add apps/api/src/modules/shareholders/ apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat: add audit logging to shareholder create/update paths"
```

---

### Task 4: Instrument Auth & User Update Paths

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/users/users.service.ts`

**Step 1: Add audit logging to auth.service.ts**

Inject `AuditService` in the constructor:

```typescript
import { AuditService } from '../audit/audit.service';

constructor(
  private prisma: PrismaService,
  private usersService: UsersService,
  private jwtService: JwtService,
  private emailService: EmailService,
  private coopsService: CoopsService,
  private auditService: AuditService,
) {}
```

In `changePassword()` (around line 438), after the `prisma.user.update()`:

```typescript
await this.auditService.log({
  entity: 'User',
  entityId: userId,
  action: 'UPDATE',
  changes: [{ field: 'passwordHash', oldValue: '***', newValue: '***' }],
  actorId: userId,
});
```

In `mfaEnable()` (around line 495), after the `prisma.user.update()`:

```typescript
await this.auditService.log({
  entity: 'User',
  entityId: userId,
  action: 'UPDATE',
  changes: [{ field: 'mfaEnabled', oldValue: false, newValue: true }],
  actorId: userId,
});
```

In `mfaDisable()` (around line 600), after the `prisma.user.update()`:

```typescript
await this.auditService.log({
  entity: 'User',
  entityId: userId,
  action: 'UPDATE',
  changes: [{ field: 'mfaEnabled', oldValue: true, newValue: false }],
  actorId: userId,
});
```

**Step 2: Add audit logging to users.service.ts**

Inject `AuditService`:

```typescript
import { AuditService } from '../audit/audit.service';

constructor(
  private prisma: PrismaService,
  private auditService: AuditService,
) {}
```

In `updatePreferences()`:

```typescript
async updatePreferences(userId: string, data: { name?: string; preferredLanguage?: string }) {
  const old = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, preferredLanguage: true },
  });

  const updated = await this.prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, name: true, role: true, preferredLanguage: true },
  });

  if (old) {
    const changes = this.auditService.diff(old as Record<string, unknown>, data);
    if (changes.length > 0) {
      await this.auditService.log({
        entity: 'User',
        entityId: userId,
        action: 'UPDATE',
        changes,
        actorId: userId,
      });
    }
  }

  return updated;
}
```

**Step 3: Commit**

```
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/users/users.service.ts
git commit -m "feat: add audit logging to auth and user update paths"
```

---

### Task 5: Instrument Coop Update Paths

**Files:**
- Modify: `apps/api/src/modules/coops/coops.service.ts`

**Step 1: Inject AuditService**

```typescript
import { AuditService } from '../audit/audit.service';

constructor(
  private prisma: PrismaService,
  private shareholdersService: ShareholdersService,
  private transactionsService: TransactionsService,
  private auditService: AuditService,
) {}
```

**Step 2: Add logging to update()**

In `update()` method (line 314), the `coop` is already fetched. After the `prisma.coop.update()`:

```typescript
async update(id: string, updateCoopDto: UpdateCoopDto, actorId?: string) {
  const coop = await this.prisma.coop.findUnique({ where: { id } });
  if (!coop) throw new NotFoundException('Cooperative not found');

  const data: Record<string, unknown> = { ...updateCoopDto };
  if (!data.smtpPass) delete data.smtpPass;
  if (!data.graphClientSecret) delete data.graphClientSecret;
  if (data.emailProvider === null) {
    // ... existing null clearing code
  }

  const changes = this.auditService.diff(coop as Record<string, unknown>, data);

  const updated = await this.prisma.coop.update({ where: { id }, data });

  if (changes.length > 0) {
    await this.auditService.log({
      coopId: id,
      entity: 'Coop',
      entityId: id,
      action: 'UPDATE',
      changes,
      actorId,
    });
  }

  return updated;
}
```

**Step 3: Add logging to updateBranding()**

```typescript
async updateBranding(id: string, updateBrandingDto: UpdateBrandingDto, actorId?: string) {
  const coop = await this.prisma.coop.findUnique({ where: { id } });
  if (!coop) throw new NotFoundException('Cooperative not found');

  const changes = this.auditService.diff(
    { primaryColor: coop.primaryColor, secondaryColor: coop.secondaryColor },
    updateBrandingDto as Record<string, unknown>,
  );

  const updated = await this.prisma.coop.update({
    where: { id },
    data: updateBrandingDto,
  });

  if (changes.length > 0) {
    await this.auditService.log({
      coopId: id,
      entity: 'Coop',
      entityId: id,
      action: 'UPDATE',
      changes,
      actorId,
    });
  }

  return updated;
}
```

**Step 4: Update callers in admin.controller.ts**

Pass `user.id` to `coopsService.update()` and `coopsService.updateBranding()`:

```typescript
// updateSettings() — already has @CurrentUser()
return this.coopsService.update(coopId, updateCoopDto, user.id);

// updateBranding() — add @CurrentUser()
async updateBranding(
  @Param('coopId') coopId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() updateBrandingDto: UpdateBrandingDto,
) {
  return this.coopsService.updateBranding(coopId, updateBrandingDto, user.id);
}
```

**Step 5: Commit**

```
git add apps/api/src/modules/coops/coops.service.ts apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat: add audit logging to coop update paths"
```

---

### Task 6: API Endpoints for Reading Audit Logs

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/system/system.controller.ts`
- Modify: `apps/api/src/modules/system/system.module.ts`

**Step 1: Add coop-scoped audit endpoint to admin.controller.ts**

Inject `AuditService` in the constructor, then add:

```typescript
// ==================== AUDIT LOGS ====================

@Get('audit-logs')
@ApiOperation({ summary: 'Get audit logs for this coop' })
async getAuditLogs(
  @Param('coopId') coopId: string,
  @Query('entity') entity?: string,
  @Query('entityId') entityId?: string,
  @Query('page') page?: number,
  @Query('limit') limit?: number,
) {
  return this.auditService.findByCoop(coopId, {
    entity,
    entityId,
    page: Number(page) || 1,
    limit: Number(limit) || 50,
  });
}
```

**Step 2: Add global audit endpoint to system.controller.ts**

Inject `AuditService`, then add:

```typescript
// ==================== AUDIT LOGS ====================

@Get('audit-logs')
@ApiOperation({ summary: 'Get global audit logs' })
async getAuditLogs(
  @Query('coopId') coopId?: string,
  @Query('entity') entity?: string,
  @Query('entityId') entityId?: string,
  @Query('actorId') actorId?: string,
  @Query('page') page?: number,
  @Query('limit') limit?: number,
) {
  return this.auditService.findAll({
    coopId,
    entity,
    entityId,
    actorId,
    page: Number(page) || 1,
    limit: Number(limit) || 50,
  });
}
```

**Step 3: Commit**

```
git add apps/api/src/modules/admin/admin.controller.ts apps/api/src/modules/system/system.controller.ts
git commit -m "feat: add audit log API endpoints for coop admins and system admins"
```

---

### Task 7: Frontend — Shareholder History Tab

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add translations**

Add to all 4 locale files under an `"audit"` key:

```json
"audit": {
  "title": "Change History",
  "noChanges": "No changes recorded yet.",
  "field": "Field",
  "oldValue": "Old Value",
  "newValue": "New Value",
  "changedBy": "Changed By",
  "date": "Date",
  "action": "Action",
  "actions": {
    "CREATE": "Created",
    "UPDATE": "Updated",
    "DELETE": "Deleted"
  },
  "entities": {
    "Shareholder": "Shareholder",
    "User": "User",
    "Coop": "Cooperative"
  },
  "system": "System",
  "masked": "(sensitive)",
  "filters": {
    "entity": "Entity",
    "all": "All"
  }
}
```

(Translate to NL/FR/DE for the other files.)

**Step 2: Add History section to shareholder detail page**

Add a "History" section below the existing content on the shareholder detail page. This should:
1. Fetch `GET /admin/coops/:coopId/audit-logs?entity=Shareholder&entityId=:shareholderId`
2. Display as a timeline/table showing: date, actor (email), action, and field-level changes
3. Format changes as "field: oldValue → newValue"
4. Show "***" for sensitive fields
5. Use the existing `Table` component from `@/components/ui/table`

The component should be a simple `useEffect` fetch on mount, displayed in a `Card` with `CardHeader` title "Change History".

**Step 3: Commit**

```
git add apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx apps/web/messages/
git commit -m "feat: add audit history section to shareholder detail page"
```

---

### Task 8: Frontend — System Audit Log Page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/system/audit/page.tsx`
- Modify: `apps/web/src/app/[locale]/dashboard/system/layout.tsx` (add nav link if sidebar exists)

**Step 1: Create the system audit page**

Create `apps/web/src/app/[locale]/dashboard/system/audit/page.tsx`:
- Fetch `GET /system/audit-logs` with filter query params
- Filter controls: entity dropdown (All/Shareholder/User/Coop), coop dropdown, date range (optional, skip for v1)
- Table columns: Date, Coop, Entity, Action, Changes summary, Actor
- Pagination using existing page/limit pattern
- Use existing `Card`, `Table`, `Select`, `Button` components

**Step 2: Add navigation link**

Check if `apps/web/src/app/[locale]/dashboard/system/layout.tsx` has a sidebar/nav. If so, add an "Audit Log" link pointing to `/dashboard/system/audit`.

**Step 3: Commit**

```
git add apps/web/src/app/[locale]/dashboard/system/audit/ apps/web/src/app/[locale]/dashboard/system/layout.tsx
git commit -m "feat: add system-wide audit log page for system admins"
```

---

### Task 9: Build & Verify

**Step 1: Run type check**

Run: `pnpm build`
Expected: No TypeScript errors

**Step 2: Run API tests**

Run: `cd apps/api && pnpm test`
Expected: All existing tests pass

**Step 3: Manual smoke test (dev)**

Run: `pnpm dev`
1. Log in as coop admin → edit a shareholder's bank details → check shareholder detail page for history entry
2. Log in as system admin → navigate to `/dashboard/system/audit` → verify entries appear
3. Change password → verify masked entry in audit log

**Step 4: Commit any fixes, then final commit**

```
git commit -m "feat: audit history feature complete"
```
