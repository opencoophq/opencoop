# Admin Audit Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete audit trail for all auth events and admin actions, with IP/user-agent tracking and a system-admin auth activity page.

**Architecture:** Extend the existing `AuditLog` model (add `userAgent` column), widen `AuditService.log()` action types, add audit calls to all auth methods and unaudited admin CRUD, pass IP/UA from controllers via `@Req()`. Add an "Auth Activity" tab to the existing system audit page.

**Tech Stack:** NestJS, Prisma, Next.js, existing `AuditService`

---

### Task 1: Add `userAgent` column to AuditLog model

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (AuditLog model, ~line 770)

**Step 1: Add the column**

In the `AuditLog` model, add `userAgent` after `ipAddress`:

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  coopId    String?
  entity    String
  entityId  String
  action    String
  changes   Json
  actorId   String?
  ipAddress String?
  userAgent String?
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

**Step 2: Generate Prisma client**

Run: `cd packages/database && npx prisma generate`
Expected: `✔ Generated Prisma Client`

**Step 3: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(audit): add userAgent column to AuditLog model"
```

> **Note for deployer:** After deploying, run `npx prisma db push` on acc and prod to add the column.

---

### Task 2: Update AuditService to accept `userAgent` and wider action types

**Files:**
- Modify: `apps/api/src/modules/audit/audit.service.ts`

**Step 1: Update the `log()` method signature and data**

At line 24, change the `log()` method to accept `userAgent` and widen `action` to `string`:

```typescript
async log(params: {
  coopId?: string;
  entity: string;
  entityId: string;
  action: string;
  changes: Change[];
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
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
      changes: maskedChanges as unknown as Prisma.InputJsonValue,
      actorId: params.actorId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
```

The key changes:
- `action` type widens from `'CREATE' | 'UPDATE' | 'DELETE'` to `string` (to support `'LOGIN'`, `'LOGIN_FAILED'`, etc.)
- New optional `userAgent` param, written to the new column

**Step 2: Update `findAll()` to include `userAgent` in response and support `action` filter**

At line 151, add `action` to the filter params and make sure the query includes it:

```typescript
async findAll(
  params: {
    coopId?: string;
    entity?: string;
    entityId?: string;
    actorId?: string;
    action?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const page = params.page || 1;
  const limit = params.limit || 50;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params.coopId) where.coopId = params.coopId;
  if (params.entity) where.entity = params.entity;
  if (params.entityId) where.entityId = params.entityId;
  if (params.actorId) where.actorId = params.actorId;
  if (params.action) where.action = params.action;

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
```

**Step 3: Run tests**

Run: `cd apps/api && pnpm test -- --passWithNoTests 2>&1 | tail -5`

**Step 4: Commit**

```bash
git add apps/api/src/modules/audit/audit.service.ts
git commit -m "feat(audit): accept userAgent param and wider action types"
```

---

### Task 3: Add audit logging to auth service — login methods

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

The auth service methods don't currently receive `req` (IP/UA). Two options: pass IP/UA from the controller, or inject `@Req()` into the service. The cleanest approach: **pass IP/UA as optional params to each service method** from the controller.

**Step 1: Update `login()` in auth.service.ts (~line 74)**

Add `ip` and `userAgent` params. Log on success and failure:

```typescript
async login(loginDto: LoginDto, ip?: string, userAgent?: string) {
  const user = await this.validateUser(loginDto.email, loginDto.password);

  if (!user) {
    await this.auditService.log({
      entity: 'Auth',
      entityId: loginDto.email,
      action: 'LOGIN_FAILED',
      changes: [{ field: 'method', oldValue: null, newValue: 'password' }],
      ipAddress: ip,
      userAgent,
    });
    throw new UnauthorizedException('Invalid email or password');
  }

  await this.auditService.log({
    entity: 'Auth',
    entityId: user.id,
    action: 'LOGIN',
    changes: [{ field: 'method', oldValue: null, newValue: 'password' }],
    actorId: user.id,
    ipAddress: ip,
    userAgent,
  });

  this.linkOrphanShareholders(user.id, user.email).catch((err) =>
    console.error('Failed to link orphan shareholders:', err.message),
  );

  return this.issueJwtForUser(user);
}
```

**Step 2: Update login endpoint in auth.controller.ts (~line 54)**

Pass `req.ip` and `req.headers['user-agent']`:

```typescript
@Public()
@Post('login')
@Throttle({ default: { ttl: 60000, limit: 5 } })
@ApiOperation({ summary: 'Login with email and password' })
async login(@Body() loginDto: LoginDto, @Req() req: Request) {
  return this.authService.login(loginDto, req.ip, req.headers['user-agent']);
}
```

Add `import { Request } from 'express';` at the top if not already imported. Add `@Req` to the `@nestjs/common` imports.

**Step 3: Update `verifyMagicLink()` in auth.service.ts (~line 1115)**

Add `ip` and `userAgent` params. After the successful token verification and before the return:

```typescript
async verifyMagicLink(verifyMagicLinkDto: VerifyMagicLinkDto, ip?: string, userAgent?: string) {
  // ... existing validation code ...

  await this.auditService.log({
    entity: 'Auth',
    entityId: magicLinkToken.user.id,
    action: 'LOGIN',
    changes: [{ field: 'method', oldValue: null, newValue: 'magic-link' }],
    actorId: magicLinkToken.user.id,
    ipAddress: ip,
    userAgent,
  });

  // ... existing linkOrphanShareholders + return ...
}
```

Update the controller endpoint `verifyMagicLink` to pass `@Req() req` and forward `req.ip`, `req.headers['user-agent']`.

**Step 4: Update `handleOAuthLogin()` in auth.service.ts (~line 753)**

Add `ip` and `userAgent` params. Log after successful login (after `issueJwtForUser`):

```typescript
async handleOAuthLogin(
  provider: 'google' | 'apple',
  data: { providerId: string; email: string; name?: string },
  ip?: string,
  userAgent?: string,
) {
  // ... existing code to find/create user ...

  await this.auditService.log({
    entity: 'Auth',
    entityId: user.id,
    action: 'LOGIN',
    changes: [{ field: 'method', oldValue: null, newValue: provider }],
    actorId: user.id,
    ipAddress: ip,
    userAgent,
  });

  return this.issueJwtForUser(user);
}
```

Update the Google and Apple callback endpoints in auth.controller.ts to pass `req.ip` and `req.headers['user-agent']` through to `handleOAuthLogin()`.

**Step 5: Update `mfaVerify()` in auth.service.ts (~line 618)**

Add `ip` and `userAgent` params. Log success and failure:

```typescript
async mfaVerify(mfaToken: string, code?: string, recoveryCode?: string, ip?: string, userAgent?: string) {
  // ... existing verification code ...

  // On failure (before throwing):
  await this.auditService.log({
    entity: 'Auth',
    entityId: mfaToken,
    action: 'MFA_VERIFY_FAILED',
    changes: [{ field: 'method', oldValue: null, newValue: code ? 'totp' : 'recovery' }],
    ipAddress: ip,
    userAgent,
  });

  // On success (before return):
  await this.auditService.log({
    entity: 'Auth',
    entityId: user.id,
    action: 'MFA_VERIFY',
    changes: [{ field: 'method', oldValue: null, newValue: code ? 'totp' : 'recovery' }],
    actorId: user.id,
    ipAddress: ip,
    userAgent,
  });
}
```

Update the `mfaVerify` endpoint in auth.controller.ts to pass `req.ip`, `req.headers['user-agent']`.

**Step 6: Update `register()` in auth.service.ts (~line 88)**

Add `ip` and `userAgent` params. Log after successful user creation:

```typescript
async register(registerDto: RegisterDto, ip?: string, userAgent?: string) {
  // ... existing code ...
  // After user is created:
  await this.auditService.log({
    entity: 'Auth',
    entityId: user.id,
    action: 'REGISTER',
    changes: [{ field: 'email', oldValue: null, newValue: registerDto.email }],
    actorId: user.id,
    ipAddress: ip,
    userAgent,
  });
  // ... rest ...
}
```

Update the `register` endpoint in auth.controller.ts to pass `req.ip`, `req.headers['user-agent']`.

**Step 7: Update `resetPassword()` and `changePassword()`**

`resetPassword()` (~line 313): Add `ip`/`userAgent` params, log after successful reset:

```typescript
await this.auditService.log({
  entity: 'Auth',
  entityId: user.id,
  action: 'PASSWORD_RESET',
  changes: [{ field: 'passwordHash', oldValue: '***', newValue: '***' }],
  actorId: user.id,
  ipAddress: ip,
  userAgent,
});
```

`changePassword()` (~line 515): Already has an audit log call. Add `ip`/`userAgent` params and pass them through:

```typescript
async changePassword(userId: string, currentPassword: string, newPassword: string, ip?: string, userAgent?: string) {
  // ... existing code ...
  await this.auditService.log({
    entity: 'User',
    entityId: userId,
    action: 'UPDATE',
    changes: [{ field: 'passwordHash', oldValue: '***', newValue: '***' }],
    actorId: userId,
    ipAddress: ip,
    userAgent,
  });
}
```

Update both controller endpoints to pass `req.ip`, `req.headers['user-agent']`.

**Step 8: Update WebAuthn authentication**

In `apps/api/src/modules/auth/webauthn.service.ts`, the `verifyAuthentication()` method (~line 128) returns the user object. The controller then calls `authService.issueJwtForUser()`. Add the audit log in the controller's passkey login endpoint after successful auth:

```typescript
await this.auditService.log({
  entity: 'Auth',
  entityId: user.id,
  action: 'LOGIN',
  changes: [{ field: 'method', oldValue: null, newValue: 'passkey' }],
  actorId: user.id,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

**Step 9: Build and test**

Run: `cd apps/api && pnpm build 2>&1 | tail -5`
Expected: Clean build, no errors.

**Step 10: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.controller.ts apps/api/src/modules/auth/webauthn.service.ts
git commit -m "feat(audit): log all auth events with IP and user-agent"
```

---

### Task 4: Add IP/UA to existing admin audit calls + fill CRUD gaps

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/shares/share-classes.service.ts`
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/coops/coops.service.ts`
- Modify: `apps/api/src/modules/dividends/dividends.service.ts`

The existing audit calls in services don't have `ipAddress`/`userAgent` because they don't have access to `req`. Two approaches:

**Approach**: Pass `ip` and `userAgent` from the controller to each service method that does audit logging. For services that already call `auditService.log()` internally (like `channelsService`, `shareholdersService`), add optional `ip`/`userAgent` params.

For services that DON'T yet have audit logging (share classes, projects, dividends, logo), add `auditService.log()` calls.

**Step 1: Share classes — add audit logging**

In `apps/api/src/modules/shares/share-classes.service.ts`, inject `AuditService` and add logging to `create()`, `update()`, and any `delete()` method. The `AuditModule` is `@Global()` so no imports needed.

For `create()`:
```typescript
await this.auditService.log({
  coopId,
  entity: 'ShareClass',
  entityId: shareClass.id,
  action: 'CREATE',
  changes: [{ field: 'name', oldValue: null, newValue: dto.name }],
  actorId,
  ipAddress: ip,
  userAgent,
});
```

For `update()`, use `auditService.diff()` on old vs new.

**Step 2: Projects — add audit logging**

Same pattern in `apps/api/src/modules/projects/projects.service.ts`. Add `AuditService` injection, log `CREATE`/`UPDATE`/`DELETE`.

**Step 3: Dividends — add audit logging**

In `apps/api/src/modules/dividends/dividends.service.ts`, log `CREATE` for `create()`, `UPDATE` for `calculate()` and `markAsPaid()`.

**Step 4: Logo — add audit logging**

In `apps/api/src/modules/coops/coops.service.ts`, add audit log for `uploadLogo()` and `removeLogo()`:

```typescript
await this.auditService.log({
  coopId,
  entity: 'Coop',
  entityId: coopId,
  action: 'UPDATE',
  changes: [{ field: 'logo', oldValue: null, newValue: 'uploaded' }],
  actorId,
  ipAddress: ip,
  userAgent,
});
```

**Step 5: Update admin controller**

For each endpoint in `admin.controller.ts`, add `@Req() req: Request` and pass `req.ip`, `req.headers['user-agent']` to the service methods. This affects:
- All channel endpoints (already have `@CurrentUser()`, add `@Req()`)
- Share class endpoints
- Project endpoints
- Dividend endpoints
- Logo endpoints

**Step 6: Update existing audit calls to include IP/UA**

For services that already call `auditService.log()` (channels, shareholders, registrations, coops settings), add optional `ip`/`userAgent` params to their methods and pass through from the controller.

**Step 7: Build and test**

Run: `cd apps/api && pnpm build 2>&1 | tail -5`

**Step 8: Commit**

```bash
git add apps/api/src/modules/
git commit -m "feat(audit): add IP/UA to all admin actions, fill CRUD audit gaps"
```

---

### Task 5: Add "Auth" filter to system audit page + show IP/UA columns

**Files:**
- Modify: `apps/api/src/modules/system/system.controller.ts` (~line 191)
- Modify: `apps/web/src/app/[locale]/dashboard/system/audit/page.tsx`
- Modify: `apps/web/messages/en.json`, `nl.json`, `fr.json`, `de.json`

**Step 1: Add `action` query param to system audit endpoint**

In `system.controller.ts`, add `@Query('action') action?: string` and pass it to `findAll()`:

```typescript
@Get('audit-logs')
@ApiOperation({ summary: 'Get global audit logs' })
async getAuditLogs(
  @Query('coopId') coopId?: string,
  @Query('entity') entity?: string,
  @Query('entityId') entityId?: string,
  @Query('actorId') actorId?: string,
  @Query('action') action?: string,
  @Query('page') page?: number,
  @Query('limit') limit?: number,
) {
  return this.auditService.findAll({
    coopId,
    entity,
    entityId,
    actorId,
    action,
    page: Number(page) || 1,
    limit: Number(limit) || 50,
  });
}
```

**Step 2: Update the system audit page**

In `apps/web/src/app/[locale]/dashboard/system/audit/page.tsx`:

1. Add `'Auth'` to `ENTITY_OPTIONS`:
```typescript
const ENTITY_OPTIONS = ['All', 'Auth', 'Shareholder', 'User', 'Coop', 'Channel', 'ShareClass', 'Project', 'DividendPeriod'] as const;
```

2. Add `userAgent` to the `AuditLogEntry` interface:
```typescript
interface AuditLogEntry {
  // ... existing fields ...
  userAgent: string | null;
}
```

3. Add IP and User-Agent columns to the table (show them when `Auth` filter is active, or always as optional columns):
```typescript
<TableHead>{t('audit.ip')}</TableHead>
<TableHead>{t('audit.userAgent')}</TableHead>
```

And in each row:
```typescript
<TableCell className="text-xs font-mono">{entry.ipAddress ?? '—'}</TableCell>
<TableCell className="text-xs max-w-[200px] truncate" title={entry.userAgent ?? ''}>
  {entry.userAgent ?? '—'}
</TableCell>
```

4. Update `actionVariant()` to handle new action types:
```typescript
const actionVariant = (action: string) => {
  switch (action) {
    case 'CREATE':
    case 'LOGIN':
    case 'REGISTER':
    case 'MFA_VERIFY':
      return 'default';
    case 'DELETE':
    case 'LOGIN_FAILED':
    case 'MFA_VERIFY_FAILED':
      return 'destructive';
    default:
      return 'secondary';
  }
};
```

**Step 3: Add translations**

In all 4 locale files (`en.json`, `nl.json`, `fr.json`, `de.json`), add to the `audit` section:

English:
```json
"audit": {
  "ip": "IP Address",
  "userAgent": "User Agent",
  "actions": {
    "LOGIN": "Login",
    "LOGIN_FAILED": "Login Failed",
    "REGISTER": "Register",
    "MFA_VERIFY": "MFA Verified",
    "MFA_VERIFY_FAILED": "MFA Failed",
    "PASSWORD_CHANGE": "Password Changed",
    "PASSWORD_RESET": "Password Reset"
  }
}
```

Dutch:
```json
"audit": {
  "ip": "IP-adres",
  "userAgent": "User Agent",
  "actions": {
    "LOGIN": "Inloggen",
    "LOGIN_FAILED": "Inloggen Mislukt",
    "REGISTER": "Registratie",
    "MFA_VERIFY": "MFA Geverifieerd",
    "MFA_VERIFY_FAILED": "MFA Mislukt",
    "PASSWORD_CHANGE": "Wachtwoord Gewijzigd",
    "PASSWORD_RESET": "Wachtwoord Hersteld"
  }
}
```

French:
```json
"audit": {
  "ip": "Adresse IP",
  "userAgent": "Agent Utilisateur",
  "actions": {
    "LOGIN": "Connexion",
    "LOGIN_FAILED": "Échec Connexion",
    "REGISTER": "Inscription",
    "MFA_VERIFY": "MFA Vérifié",
    "MFA_VERIFY_FAILED": "MFA Échoué",
    "PASSWORD_CHANGE": "Mot de Passe Modifié",
    "PASSWORD_RESET": "Mot de Passe Réinitialisé"
  }
}
```

German:
```json
"audit": {
  "ip": "IP-Adresse",
  "userAgent": "User Agent",
  "actions": {
    "LOGIN": "Anmeldung",
    "LOGIN_FAILED": "Anmeldung Fehlgeschlagen",
    "REGISTER": "Registrierung",
    "MFA_VERIFY": "MFA Verifiziert",
    "MFA_VERIFY_FAILED": "MFA Fehlgeschlagen",
    "PASSWORD_CHANGE": "Passwort Geändert",
    "PASSWORD_RESET": "Passwort Zurückgesetzt"
  }
}
```

> **Note:** Merge these into the existing `audit` object in each locale file — don't replace it. The existing keys like `audit.title`, `audit.entity`, `audit.action`, `audit.changes`, `audit.changedBy`, `audit.date`, `audit.noChanges`, `audit.system`, `audit.actions.CREATE`, `audit.actions.UPDATE`, `audit.actions.DELETE` must be preserved.

**Step 4: Build frontend**

Run: `pnpm --filter web build 2>&1 | tail -5`

**Step 5: Commit**

```bash
git add apps/api/src/modules/system/system.controller.ts apps/web/src/app/\[locale\]/dashboard/system/audit/page.tsx apps/web/messages/
git commit -m "feat(audit): show auth events and IP/UA in system audit page"
```

---

### Task 6: Deploy and push schema

**Step 1: Push to main**

```bash
git push origin main
```

**Step 2: Wait for acc deploy**

```bash
gh run list --limit 1
gh run watch <run-id>
```

**Step 3: Push schema to acc**

```bash
ssh wouter@fsn1.tailde0fcd.ts.net "cd ~/opencoop/acc && docker compose exec -T api npx prisma db push --accept-data-loss --schema /app/node_modules/@opencoop/database/prisma/schema.prisma"
```

**Step 4: Test on acc**

Log in to acc.opencoop.be, check system audit page, verify login event appears.

**Step 5: Tag for prod**

```bash
git tag -a v0.3.2 -m "feat: complete admin audit logging"
git push origin v0.3.2
```

**Step 6: Push schema to prod**

```bash
ssh wouter@fsn1.tailde0fcd.ts.net "cd ~/opencoop/prod && docker compose exec -T api npx prisma db push --accept-data-loss --schema /app/node_modules/@opencoop/database/prisma/schema.prisma"
```
