# Coop Admin Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow coop admins to invite/manage other coop admins with granular, role-based permissions (Admin, Viewer, GDPR Viewer, GDPR Admin + custom roles).

**Architecture:** New `CoopRole` model stores named permission sets per coop. `CoopAdmin` gains a `roleId` FK. New `AdminInvitation` model handles email-based invites. A `PermissionGuard` replaces the flat role check with per-permission enforcement. JWT payload gains `coopPermissions`. Frontend gates UI/nav based on permissions.

**Tech Stack:** Prisma (schema + migration), NestJS (guards, decorators, controller, service), Next.js (pages, context), nodemailer (invite emails)

---

## Task 1: Prisma Schema — Add CoopRole, AdminInvitation, Modify CoopAdmin

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add CoopRole model and AdminInvitation model, modify CoopAdmin**

Add after line 263 (after `CoopAdmin` closing brace) — but first modify `CoopAdmin` itself:

```prisma
// Replace the existing CoopAdmin model (lines 252-263) with:
model CoopAdmin {
  id        String   @id @default(cuid())
  userId    String
  coopId    String
  roleId    String
  createdAt DateTime @default(now())

  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  coop Coop     @relation(fields: [coopId], references: [id], onDelete: Cascade)
  role CoopRole @relation(fields: [roleId], references: [id])

  @@unique([userId, coopId])
  @@map("coop_admins")
}

// Add these two new models after CoopAdmin:
model CoopRole {
  id          String   @id @default(cuid())
  coopId      String
  name        String
  permissions Json
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  coop        Coop          @relation(fields: [coopId], references: [id], onDelete: Cascade)
  coopAdmins  CoopAdmin[]
  invitations AdminInvitation[]

  @@unique([coopId, name])
  @@map("coop_roles")
}

model AdminInvitation {
  id        String   @id @default(cuid())
  coopId    String
  email     String
  roleId    String
  token     String   @unique
  expiresAt DateTime
  accepted  Boolean  @default(false)
  createdAt DateTime @default(now())

  coop Coop     @relation(fields: [coopId], references: [id], onDelete: Cascade)
  role CoopRole @relation(fields: [roleId], references: [id])

  @@unique([coopId, email])
  @@map("admin_invitations")
}
```

Also add relations to the `Coop` model (around line 159, in the relations section):
```prisma
  roles            CoopRole[]
  adminInvitations AdminInvitation[]
```

**Step 2: Generate Prisma client to validate schema**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm db:generate`
Expected: "Generated Prisma Client"

**Step 3: Create migration with data backfill**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm --filter @opencoop/database exec prisma migrate dev --name add-coop-roles-and-invitations --create-only`

This creates the migration SQL file without running it. We need to edit it to:
1. Create `coop_roles` table
2. Create `admin_invitations` table
3. Add `roleId` column to `coop_admins` (nullable first)
4. Seed default roles for every existing coop
5. Backfill existing `coop_admins` with the "Admin" default role
6. Make `roleId` NOT NULL
7. Add FK constraint

Edit the generated migration SQL to include the backfill:

```sql
-- After the CREATE TABLE statements and before the ALTER TABLE for FK:

-- Seed default roles for all existing coops
INSERT INTO "coop_roles" ("id", "coopId", "name", "permissions", "isDefault", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c.id,
  role.name,
  role.permissions::jsonb,
  true,
  NOW(),
  NOW()
FROM "coops" c
CROSS JOIN (VALUES
  ('Admin', '{"canManageShareholders":true,"canManageTransactions":true,"canManageShareClasses":true,"canManageProjects":true,"canManageDividends":true,"canManageSettings":true,"canManageAdmins":true,"canViewPII":true,"canViewReports":true,"canViewShareholderRegister":true}'),
  ('Viewer', '{"canManageShareholders":false,"canManageTransactions":false,"canManageShareClasses":false,"canManageProjects":false,"canManageDividends":false,"canManageSettings":false,"canManageAdmins":false,"canViewPII":true,"canViewReports":true,"canViewShareholderRegister":true}'),
  ('GDPR Viewer', '{"canManageShareholders":false,"canManageTransactions":false,"canManageShareClasses":false,"canManageProjects":false,"canManageDividends":false,"canManageSettings":false,"canManageAdmins":false,"canViewPII":false,"canViewReports":true,"canViewShareholderRegister":false}'),
  ('GDPR Admin', '{"canManageShareholders":false,"canManageTransactions":false,"canManageShareClasses":true,"canManageProjects":true,"canManageDividends":true,"canManageSettings":true,"canManageAdmins":false,"canViewPII":false,"canViewReports":true,"canViewShareholderRegister":false}')
) AS role(name, permissions);

-- Backfill existing coop_admins with the "Admin" role
UPDATE "coop_admins" ca
SET "roleId" = cr.id
FROM "coop_roles" cr
WHERE cr."coopId" = ca."coopId" AND cr.name = 'Admin';

-- Now make roleId NOT NULL
ALTER TABLE "coop_admins" ALTER COLUMN "roleId" SET NOT NULL;
```

**Step 4: Run migration**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm --filter @opencoop/database exec prisma migrate dev`
Expected: Migration applied successfully

**Step 5: Regenerate Prisma client**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm db:generate`

**Step 6: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat: add CoopRole and AdminInvitation models with migration

Add granular permission system for coop admins. Each coop gets 4 default
roles (Admin, Viewer, GDPR Viewer, GDPR Admin). Existing admins are
backfilled with the Admin role."
```

---

## Task 2: Shared Types — Add CoopPermissions Interface

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Add CoopPermissions interface**

Add after the `JwtPayload` interface (after line 70):

```typescript
// ============================================================================
// Coop Permissions
// ============================================================================

export interface CoopPermissions {
  canManageShareholders: boolean;
  canManageTransactions: boolean;
  canManageShareClasses: boolean;
  canManageProjects: boolean;
  canManageDividends: boolean;
  canManageSettings: boolean;
  canManageAdmins: boolean;
  canViewPII: boolean;
  canViewReports: boolean;
  canViewShareholderRegister: boolean;
}

export const DEFAULT_ROLES: Record<string, CoopPermissions> = {
  Admin: {
    canManageShareholders: true,
    canManageTransactions: true,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageSettings: true,
    canManageAdmins: true,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
  },
  Viewer: {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: true,
    canViewReports: true,
    canViewShareholderRegister: true,
  },
  'GDPR Viewer': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: false,
    canManageProjects: false,
    canManageDividends: false,
    canManageSettings: false,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
  },
  'GDPR Admin': {
    canManageShareholders: false,
    canManageTransactions: false,
    canManageShareClasses: true,
    canManageProjects: true,
    canManageDividends: true,
    canManageSettings: true,
    canManageAdmins: false,
    canViewPII: false,
    canViewReports: true,
    canViewShareholderRegister: false,
  },
};

export type CoopPermissionKey = keyof CoopPermissions;
```

Also update the `JwtPayload` interface (lines 63-70) to include permissions:

```typescript
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  coopIds?: string[];
  coopPermissions?: Record<string, CoopPermissions>;
  iat?: number;
  exp?: number;
}
```

**Step 2: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add CoopPermissions interface and default role definitions"
```

---

## Task 3: Backend — PermissionGuard and Decorator

**Files:**
- Create: `apps/api/src/common/decorators/permissions.decorator.ts`
- Create: `apps/api/src/common/guards/permission.guard.ts`
- Modify: `apps/api/src/common/decorators/current-user.decorator.ts`

**Step 1: Create the permissions decorator**

```typescript
// apps/api/src/common/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { CoopPermissionKey } from '@opencoop/shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermission = (...permissions: CoopPermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

**Step 2: Create the permission guard**

```typescript
// apps/api/src/common/guards/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CoopPermissionKey, CoopPermissions } from '@opencoop/shared';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<CoopPermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const coopId = request.params.coopId;

    // System admins bypass permission checks
    if (user.role === 'SYSTEM_ADMIN') {
      return true;
    }

    const permissions: CoopPermissions | undefined = user.coopPermissions?.[coopId];
    if (!permissions) {
      throw new ForbiddenException('No permissions for this cooperative');
    }

    const hasAll = requiredPermissions.every((p) => permissions[p] === true);
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
```

**Step 3: Update CurrentUserData interface**

In `apps/api/src/common/decorators/current-user.decorator.ts`, update the interface:

```typescript
import { CoopPermissions } from '@opencoop/shared';

export interface CurrentUserData {
  id: string;
  email: string;
  role: string;
  coopIds?: string[];
  coopPermissions?: Record<string, CoopPermissions>;
}
```

**Step 4: Commit**

```bash
git add apps/api/src/common/decorators/permissions.decorator.ts apps/api/src/common/guards/permission.guard.ts apps/api/src/common/decorators/current-user.decorator.ts
git commit -m "feat: add PermissionGuard and RequirePermission decorator"
```

---

## Task 4: Backend — Update JWT to Include Permissions

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (lines 1317-1359)
- Modify: `apps/api/src/modules/auth/strategies/jwt.strategy.ts` (line 16)

**Step 1: Update issueJwtForUser to include coopPermissions**

In `auth.service.ts`, update the `issueJwtForUser` method (line 1317). Change the method signature to accept `coopAdminOf` with role permissions:

```typescript
private issueJwtForUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  preferredLanguage: string;
  emailVerified: Date | null;
  mfaEnabled?: boolean;
  coopAdminOf?: { coopId: string; role: { permissions: any } }[];
}) {
  const coopIds = (user.coopAdminOf ?? []).map((ca) => ca.coopId);
  const coopPermissions: Record<string, any> = {};
  for (const ca of user.coopAdminOf ?? []) {
    coopPermissions[ca.coopId] = ca.role.permissions;
  }

  // ... MFA section unchanged ...

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    ...(coopIds.length > 0 && { coopIds }),
    ...(Object.keys(coopPermissions).length > 0 && { coopPermissions }),
  };

  return {
    accessToken: this.jwtService.sign(payload),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      preferredLanguage: user.preferredLanguage,
      emailVerified: !!user.emailVerified,
    },
  };
}
```

**Step 2: Update all places that load coopAdminOf to include role**

Search for `coopAdminOf` includes in auth.service.ts (e.g., `validateUser` around line 38) and update:

```typescript
// Change from:
coopAdminOf: { select: { coopId: true } },
// To:
coopAdminOf: { select: { coopId: true, role: { select: { permissions: true } } } },
```

Do this for ALL queries that load `coopAdminOf` in auth.service.ts (there are multiple — `validateUser`, `validateMagicLink`, `completeMfaLogin`, `onboarding`).

**Step 3: Update JWT strategy to pass through coopPermissions**

In `jwt.strategy.ts` (line 16), update the validate method:

```typescript
async validate(payload: {
  sub: string;
  email: string;
  role: string;
  type?: string;
  coopIds?: string[];
  coopPermissions?: Record<string, any>;
}) {
  if (payload.type === 'mfa-pending') {
    throw new UnauthorizedException('MFA verification required');
  }

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    coopIds: payload.coopIds,
    coopPermissions: payload.coopPermissions,
  };
}
```

**Step 4: Update onboarding to create default roles and assign Admin role**

In auth.service.ts, in the onboarding `$transaction` (around line 170-199), after creating the coop, seed default roles and assign the Admin role:

```typescript
// After coop creation (line 192):
const { DEFAULT_ROLES } = require('@opencoop/shared');

// Create default roles
const roles = await Promise.all(
  Object.entries(DEFAULT_ROLES).map(([name, permissions]) =>
    tx.coopRole.create({
      data: {
        coopId: coop.id,
        name,
        permissions: permissions as any,
        isDefault: true,
      },
    }),
  ),
);

const adminRole = roles.find((r) => r.name === 'Admin')!;

// Update CoopAdmin creation to include roleId:
await tx.coopAdmin.create({
  data: {
    userId: user.id,
    coopId: coop.id,
    roleId: adminRole.id,
  },
});
```

**Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/strategies/jwt.strategy.ts
git commit -m "feat: include coopPermissions in JWT payload

Permissions are loaded from CoopRole at login time and encoded in the
JWT token. Updated onboarding to seed default roles for new coops."
```

---

## Task 5: Backend — Coop Admin & Role Management Endpoints

**Files:**
- Create: `apps/api/src/modules/coop-admins/coop-admins.controller.ts`
- Create: `apps/api/src/modules/coop-admins/coop-admins.service.ts`
- Create: `apps/api/src/modules/coop-admins/coop-admins.module.ts`
- Create: `apps/api/src/modules/coop-admins/dto/invite-admin.dto.ts`
- Create: `apps/api/src/modules/coop-admins/dto/create-role.dto.ts`
- Create: `apps/api/src/modules/coop-admins/dto/update-role.dto.ts`
- Modify: `apps/api/src/app.module.ts` (register the new module)

**Step 1: Create DTOs**

`invite-admin.dto.ts`:
```typescript
import { IsEmail, IsString } from 'class-validator';
export class InviteAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  roleId: string;
}
```

`create-role.dto.ts`:
```typescript
import { IsString, IsObject } from 'class-validator';
import { CoopPermissions } from '@opencoop/shared';
export class CreateRoleDto {
  @IsString()
  name: string;

  @IsObject()
  permissions: CoopPermissions;
}
```

`update-role.dto.ts`:
```typescript
import { IsString, IsObject, IsOptional } from 'class-validator';
import { CoopPermissions } from '@opencoop/shared';
export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsObject()
  @IsOptional()
  permissions?: CoopPermissions;
}
```

**Step 2: Create the service**

`coop-admins.service.ts` — methods:
- `getRoles(coopId)` — list all roles for a coop
- `createRole(coopId, dto)` — create custom role
- `updateRole(coopId, roleId, dto)` — update role name/permissions
- `deleteRole(coopId, roleId)` — delete custom role (fail if `isDefault` or has admins assigned)
- `getAdmins(coopId)` — list admins with user info and role
- `inviteAdmin(coopId, dto)` — create invitation, send email
- `acceptInvitation(token)` — accept invitation, create CoopAdmin
- `updateAdminRole(coopId, adminId, roleId)` — change an admin's role
- `removeAdmin(coopId, adminId)` — remove admin (prevent removing last admin with `canManageAdmins`)
- `getInvitations(coopId)` — list pending invitations
- `revokeInvitation(coopId, invitationId)` — delete pending invitation

Key implementation details:
- `inviteAdmin`: Generate crypto token (`crypto.randomBytes(32).toString('hex')`), set 7-day expiry. Use `EmailService.sendPlatformEmail` to send invite link. The link is `${NEXT_PUBLIC_APP_URL}/invite/${token}`.
- `acceptInvitation`: Look up invitation by token, check not expired/accepted. Find or create user by email. Create `CoopAdmin` entry. Upgrade user role to `COOP_ADMIN` if currently `SHAREHOLDER`. Mark invitation accepted.
- `removeAdmin`: Count remaining admins with `canManageAdmins` permission. If this is the last one, throw error.

**Step 3: Create the controller**

`coop-admins.controller.ts`:
```typescript
@ApiTags('coop-admins')
@Controller('admin/coops/:coopId/team')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, PermissionGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class CoopAdminsController {
  // Roles management
  @Get('roles')
  getRoles(@Param('coopId') coopId: string) {}

  @Post('roles')
  @RequirePermission('canManageAdmins')
  createRole(@Param('coopId') coopId: string, @Body() dto: CreateRoleDto) {}

  @Put('roles/:roleId')
  @RequirePermission('canManageAdmins')
  updateRole(@Param('coopId') coopId: string, @Param('roleId') roleId: string, @Body() dto: UpdateRoleDto) {}

  @Delete('roles/:roleId')
  @RequirePermission('canManageAdmins')
  deleteRole(@Param('coopId') coopId: string, @Param('roleId') roleId: string) {}

  // Admin management
  @Get()
  getAdmins(@Param('coopId') coopId: string) {}

  @Post('invite')
  @RequirePermission('canManageAdmins')
  inviteAdmin(@Param('coopId') coopId: string, @Body() dto: InviteAdminDto) {}

  @Put(':adminId/role')
  @RequirePermission('canManageAdmins')
  updateAdminRole(@Param('coopId') coopId: string, @Param('adminId') adminId: string, @Body('roleId') roleId: string) {}

  @Delete(':adminId')
  @RequirePermission('canManageAdmins')
  removeAdmin(@Param('coopId') coopId: string, @Param('adminId') adminId: string) {}

  // Invitations
  @Get('invitations')
  @RequirePermission('canManageAdmins')
  getInvitations(@Param('coopId') coopId: string) {}

  @Delete('invitations/:invitationId')
  @RequirePermission('canManageAdmins')
  revokeInvitation(@Param('coopId') coopId: string, @Param('invitationId') invitationId: string) {}
}
```

**Step 4: Create a PUBLIC endpoint for accepting invitations**

Add to `auth.controller.ts` (since it handles unauthenticated flows):
```typescript
@Post('accept-invitation')
@Public()
async acceptInvitation(@Body('token') token: string) {
  return this.coopAdminsService.acceptInvitation(token);
}
```

Or alternatively create a separate route. The key is this must be `@Public()` because the invitee may not have an account yet.

**Step 5: Create the module**

`coop-admins.module.ts`: Register controller, service, import PrismaModule, EmailModule.

**Step 6: Register in app.module.ts**

Add `CoopAdminsModule` to imports.

**Step 7: Commit**

```bash
git add apps/api/src/modules/coop-admins/ apps/api/src/app.module.ts
git commit -m "feat: add coop admin and role management endpoints

- CRUD for coop roles with permission sets
- Invite admin by email with token-based flow
- Accept invitation (public endpoint)
- Update admin role, remove admin
- List/revoke pending invitations"
```

---

## Task 6: Backend — Add PermissionGuard to Existing Admin Endpoints

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts`

**Step 1: Add PermissionGuard to the controller's UseGuards**

At line 50, update:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard, SubscriptionGuard, PermissionGuard)
```

**Step 2: Add @RequirePermission decorators to each endpoint group**

Go through all endpoints in `admin.controller.ts` and annotate:

- **Settings endpoints** (`getSettings`, `updateSettings`, `updateBranding`, etc.): `@RequirePermission('canManageSettings')`
- **Shareholder endpoints** (`getShareholders`, `createShareholder`, etc.): `@RequirePermission('canManageShareholders')`
- **Share class endpoints**: `@RequirePermission('canManageShareClasses')`
- **Transaction endpoints**: `@RequirePermission('canManageTransactions')`
- **Project endpoints**: `@RequirePermission('canManageProjects')`
- **Dividend endpoints**: `@RequirePermission('canManageDividends')`
- **Report endpoints**: `@RequirePermission('canViewReports')`
- **Dashboard/analytics endpoints**: No specific permission needed (all admins can see the dashboard overview)

For read-only endpoints under a `canManage*` permission (e.g., GET shareholders), consider that `canManage*` implies both read and write. Viewers who just have `canViewPII` but not `canManageShareholders` won't need these endpoints at all since they don't have a shareholders nav item.

**Step 3: Add PII masking to shareholder list/detail endpoints**

For the shareholder list endpoint, check `canViewPII`. If false, mask `name`, `email`, `phone`, `address` fields in the response. Implement this in the service layer or as a response interceptor.

Simplest approach — in `admin.controller.ts` shareholder GET endpoints:
```typescript
@Get('shareholders')
async getShareholders(
  @Param('coopId') coopId: string,
  @Query() query: any,
  @CurrentUser() user: CurrentUserData,
) {
  const result = await this.shareholdersService.findAll(coopId, query);
  const canViewPII = user.role === 'SYSTEM_ADMIN' || user.coopPermissions?.[coopId]?.canViewPII;
  if (!canViewPII) {
    return maskPII(result);
  }
  return result;
}
```

Create a utility `maskPII` function in `apps/api/src/common/utils/mask-pii.ts`:
```typescript
export function maskShareholderPII(shareholder: any) {
  return {
    ...shareholder,
    name: `Aandeelhouder #${shareholder.shareholderNumber || shareholder.id.slice(-4)}`,
    email: '***',
    phone: shareholder.phone ? '***' : null,
    address: shareholder.address ? '***' : null,
    city: shareholder.city ? '***' : null,
    postalCode: shareholder.postalCode ? '***' : null,
    companyName: shareholder.companyName ? '***' : null,
    companyId: shareholder.companyId ? '***' : null,
  };
}
```

**Step 4: Commit**

```bash
git add apps/api/src/modules/admin/admin.controller.ts apps/api/src/common/utils/mask-pii.ts
git commit -m "feat: enforce granular permissions on all admin endpoints

Add @RequirePermission decorators to all admin controller endpoints.
Add PII masking for admins without canViewPII permission."
```

---

## Task 7: Frontend — Permissions Context

**Files:**
- Create: `apps/web/src/contexts/permissions-context.tsx`
- Modify: `apps/web/src/contexts/admin-context.tsx`

**Step 1: Create permissions context**

```typescript
// apps/web/src/contexts/permissions-context.tsx
'use client';
import { createContext, useContext, useMemo } from 'react';
import { CoopPermissions } from '@opencoop/shared';

interface PermissionsContextValue {
  permissions: CoopPermissions | null;
  hasPermission: (key: keyof CoopPermissions) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: null,
  hasPermission: () => false,
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  // Read from localStorage (JWT decoded) or from admin context
  const permissions = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const selectedCoopId = localStorage.getItem('selectedCoopId');
      if (!selectedCoopId || !payload.coopPermissions) return null;
      return payload.coopPermissions[selectedCoopId] as CoopPermissions ?? null;
    } catch {
      return null;
    }
  }, []);

  const hasPermission = (key: keyof CoopPermissions) => {
    // System admins have all permissions
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        const user = JSON.parse(userData);
        if (user.role === 'SYSTEM_ADMIN') return true;
      }
    } catch {}
    return permissions?.[key] === true;
  };

  return (
    <PermissionsContext.Provider value={{ permissions, hasPermission }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionsContext);
```

Note: The `useMemo` dependencies should be updated to react to coop selection changes. Consider listening to `selectedCoop` from admin context or re-reading on coop change. Implementation detail to handle during coding.

**Step 2: Wrap admin layout with PermissionsProvider**

In `apps/web/src/app/[locale]/dashboard/admin/layout.tsx`, wrap children with `<PermissionsProvider>`.

**Step 3: Commit**

```bash
git add apps/web/src/contexts/permissions-context.tsx apps/web/src/app/[locale]/dashboard/admin/layout.tsx
git commit -m "feat: add PermissionsProvider context for frontend permission checks"
```

---

## Task 8: Frontend — Permission-Gated Navigation

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx` (lines 144-157)

**Step 1: Gate admin nav items based on permissions**

Update the `adminNav` array to filter based on permissions. Use `usePermissions()` hook:

```typescript
const { hasPermission } = usePermissions();

const adminNav: NavItem[] = selectedCoop
  ? [
      { href: '/dashboard/admin', label: t('common.overview'), icon: ... },
      hasPermission('canManageShareholders') && { href: '/dashboard/admin/shareholders', ... },
      hasPermission('canManageShareClasses') && { href: '/dashboard/admin/share-classes', ... },
      hasPermission('canManageTransactions') && { href: '/dashboard/admin/transactions', ... },
      hasPermission('canManageProjects') && { href: '/dashboard/admin/projects', ... },
      hasPermission('canManageDividends') && { href: '/dashboard/admin/dividends', ... },
      // Bank import requires transaction management
      hasPermission('canManageTransactions') && { href: '/dashboard/admin/bank-import', ... },
      hasPermission('canViewReports') && { href: '/dashboard/admin/reports', ... },
      hasPermission('canManageSettings') && { href: '/dashboard/admin/settings', ... },
      hasPermission('canManageSettings') && { href: '/dashboard/admin/billing', ... },
      // New team page
      hasPermission('canManageAdmins') && { href: '/dashboard/admin/team', ... },
    ].filter(Boolean) as NavItem[]
  : [];
```

Note: The "overview" dashboard should always be visible to all admin roles.

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/layout.tsx
git commit -m "feat: gate admin navigation items based on coop permissions"
```

---

## Task 9: Frontend — Team Management Page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/team/page.tsx`

**Step 1: Build the team management page**

Features:
- List current admins: name, email, role name, created date
- "Invite admin" button → opens dialog with email input + role dropdown
- Per-admin actions: change role (dropdown), remove (with confirmation)
- Pending invitations section: email, role, sent date, resend/revoke buttons
- Link to role management page

Use existing UI components from `components/ui/` (Table, Button, Dialog, Select, etc.)

API calls:
- `GET /admin/coops/${coopId}/team` → load admins
- `POST /admin/coops/${coopId}/team/invite` → invite
- `PUT /admin/coops/${coopId}/team/${adminId}/role` → change role
- `DELETE /admin/coops/${coopId}/team/${adminId}` → remove
- `GET /admin/coops/${coopId}/team/invitations` → pending invites
- `DELETE /admin/coops/${coopId}/team/invitations/${id}` → revoke
- `GET /admin/coops/${coopId}/team/roles` → load roles for dropdown

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/team/
git commit -m "feat: add team management page for coop admins"
```

---

## Task 10: Frontend — Role Management Page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/team/roles/page.tsx`

**Step 1: Build the role management page**

Features:
- List roles: name, permission summary, admin count, default badge
- "Create role" button → dialog with name input + permission toggle grid
- Edit role → same dialog pre-filled
- Delete custom role → confirmation dialog (must reassign admins first if any are assigned)
- Default roles show lock icon but are still editable

Permission toggle grid: A table with permission names (human-readable) and toggle switches.

Permission labels (for i18n):
- `canManageShareholders` → "Manage shareholders"
- `canManageTransactions` → "Manage transactions"
- `canManageShareClasses` → "Manage share classes"
- `canManageProjects` → "Manage projects"
- `canManageDividends` → "Manage dividends"
- `canManageSettings` → "Manage settings"
- `canManageAdmins` → "Manage team"
- `canViewPII` → "View personal information"
- `canViewReports` → "View reports"
- `canViewShareholderRegister` → "View shareholder register"

API calls:
- `GET /admin/coops/${coopId}/team/roles`
- `POST /admin/coops/${coopId}/team/roles`
- `PUT /admin/coops/${coopId}/team/roles/${roleId}`
- `DELETE /admin/coops/${coopId}/team/roles/${roleId}`

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/team/roles/
git commit -m "feat: add role management page with permission toggles"
```

---

## Task 11: Frontend — Invite Acceptance Page

**Files:**
- Create: `apps/web/src/app/[locale]/invite/[token]/page.tsx`

**Step 1: Build the invitation acceptance page**

Flow:
1. Page loads → calls `POST /auth/accept-invitation` with the token
2. If user not logged in → redirect to `/login?redirect=/invite/${token}` (or `/register?redirect=/invite/${token}&email=${invitedEmail}`)
3. If user logged in → accept invitation, show success, redirect to `/dashboard/admin`
4. If token expired/invalid → show error message

Keep it simple: a clean page with coop name, role being assigned, and accept/decline buttons.

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/invite/
git commit -m "feat: add invitation acceptance page"
```

---

## Task 12: Frontend — Gate Reports Based on Permissions

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/reports/page.tsx`

**Step 1: Gate report access based on permissions**

- Hide "Shareholder Register" tab when `!hasPermission('canViewShareholderRegister')`
- Hide "Capital Statement" transactions section when `!hasPermission('canManageTransactions')`
- If `!hasPermission('canViewReports')`, the nav item is already hidden (Task 8), but add a redirect guard on the page too

**Step 2: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/reports/
git commit -m "feat: gate report access based on coop permissions"
```

---

## Task 13: Translations

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add translation keys for team management**

Add under `admin` section:
```json
{
  "admin": {
    "team": {
      "title": "Team",
      "admins": "Administrators",
      "inviteAdmin": "Invite admin",
      "inviteDescription": "Send an invitation email to add a new administrator.",
      "email": "Email address",
      "role": "Role",
      "sendInvitation": "Send invitation",
      "invitationSent": "Invitation sent",
      "changeRole": "Change role",
      "removeAdmin": "Remove admin",
      "removeConfirm": "Are you sure you want to remove this administrator?",
      "lastAdminWarning": "Cannot remove the last administrator with management permissions.",
      "pendingInvitations": "Pending invitations",
      "resend": "Resend",
      "revoke": "Revoke",
      "noAdmins": "No administrators yet.",
      "noPendingInvitations": "No pending invitations.",
      "roles": {
        "title": "Roles",
        "createRole": "Create role",
        "editRole": "Edit role",
        "deleteRole": "Delete role",
        "deleteConfirm": "Are you sure you want to delete this role?",
        "reassignFirst": "Reassign all administrators using this role before deleting it.",
        "defaultRole": "Default role",
        "customRole": "Custom role",
        "roleName": "Role name",
        "permissions": "Permissions",
        "adminCount": "{count} admin(s)"
      }
    },
    "permissions": {
      "canManageShareholders": "Manage shareholders",
      "canManageTransactions": "Manage transactions",
      "canManageShareClasses": "Manage share classes",
      "canManageProjects": "Manage projects",
      "canManageDividends": "Manage dividends",
      "canManageSettings": "Manage settings",
      "canManageAdmins": "Manage team",
      "canViewPII": "View personal information",
      "canViewReports": "View reports",
      "canViewShareholderRegister": "View shareholder register"
    }
  }
}
```

Do the same for nl.json, fr.json, de.json with proper translations.

**Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add i18n translations for team management (en, nl, fr, de)"
```

---

## Task 14: Update Seed Script

**Files:**
- Modify: `packages/database/prisma/seed.ts`

**Step 1: Update seed to create default roles and assign to CoopAdmin**

Around lines 99-125, after creating the demo coop:
1. Create the 4 default roles for the demo coop
2. Update CoopAdmin.upsert calls to include `roleId` pointing to the Admin role

**Step 2: Also update seed-demo.ts if it exists**

Check `packages/database/prisma/seed-demo.ts` and update similarly.

**Step 3: Run seed to verify**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm --filter @opencoop/database exec prisma db seed`

**Step 4: Commit**

```bash
git add packages/database/prisma/seed.ts packages/database/prisma/seed-demo.ts
git commit -m "feat: update seed scripts to create default coop roles"
```

---

## Task 15: Build Verification

**Step 1: Run full build**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins && pnpm build`
Expected: All packages build successfully

**Step 2: Run API tests**

Run: `cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins/apps/api && pnpm test`
Expected: All tests pass

**Step 3: Test Docker builds locally**

Run:
```bash
cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/coopadmins-add-coopadmins
docker build -f apps/api/Dockerfile .
docker build -f apps/web/Dockerfile .
```
Expected: Both build successfully

**Step 4: Commit any fixes**

---

## Task 16: Deploy to Acceptance

**Step 1: Push to main**

```bash
git push origin main
```

This triggers CI → builds Docker images → deploys to acc.opencoop.be

**Step 2: Verify on acc**

- Check acc.opencoop.be loads correctly
- Log in as coop admin
- Check JWT contains `coopPermissions`
- Verify team page is accessible
- Verify permission-gated navigation works
- Test invite flow (send invite, check email, accept)
- Test role management (create, edit, delete)

---

## Task 17: Deploy to Production

**Step 1: Update CHANGELOG.md**

Add new version entry with:
- feat: coop admin management with granular permissions
- feat: role-based access control (Admin, Viewer, GDPR Viewer, GDPR Admin)
- feat: custom roles with configurable permissions
- feat: email-based admin invitations
- feat: PII masking for GDPR-restricted roles

**Step 2: Tag and push**

```bash
git tag -a v0.1.73 -m "feat: coop admin management with granular permissions"
git push origin v0.1.73
```

**Step 3: Verify migration runs on prod**

SSH to fsn1 and verify the migration applied:
```bash
ssh wouter@fsn1.tailde0fcd.ts.net
cd ~/opencoop/prod
docker compose exec api npx prisma migrate status
```

**Step 4: Verify on production**

- Check opencoop.be loads correctly
- Test with demo coop admin (admin@zonnecooperatie.be)
- Verify default roles were seeded for all existing coops
- Verify existing admins were assigned the Admin role
