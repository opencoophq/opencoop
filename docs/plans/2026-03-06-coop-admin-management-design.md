# Coop Admin Management with Granular Permissions

**Date:** 2026-03-06
**Status:** Approved

## Problem

Only SYSTEM_ADMINs can add coop admins. Coop admins need to manage their own team. Additionally, different admins need different access levels — some need full control, others only financial reports, and some must be GDPR-restricted (no access to personally identifiable information).

## Data Model

### New: `CoopRole`

Defines named roles with granular permissions, scoped per coop.

```prisma
model CoopRole {
  id          String   @id @default(cuid())
  coopId      String
  name        String
  permissions Json     // CoopPermissions object
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  coop       Coop        @relation(fields: [coopId], references: [id], onDelete: Cascade)
  coopAdmins CoopAdmin[]

  @@unique([coopId, name])
  @@map("coop_roles")
}
```

### Modified: `CoopAdmin`

Add `roleId` foreign key to link each admin to a role.

```prisma
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
```

### New: `AdminInvitation`

Tracks pending invitations sent by coop admins.

```prisma
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

### Permissions Object

Stored as JSON on `CoopRole.permissions`:

```typescript
interface CoopPermissions {
  canManageShareholders: boolean;      // View/create/edit/delete shareholders (includes PII)
  canManageTransactions: boolean;      // View/create/edit/delete transactions
  canManageShareClasses: boolean;      // Create/edit share classes
  canManageProjects: boolean;          // Create/edit projects
  canManageDividends: boolean;         // Create/edit dividend rounds
  canManageSettings: boolean;          // Edit coop settings, branding
  canManageAdmins: boolean;            // Add/remove/edit other coop admins & roles
  canViewPII: boolean;                 // See names, emails, phones, addresses
  canViewReports: boolean;             // Access financial reports, kapitaaloverzicht
  canViewShareholderRegister: boolean; // Access shareholder register report
}
```

## 4 Default Roles (seeded per coop)

| Role | Permissions |
|------|------------|
| **Admin** | All `true` |
| **Viewer** | All `canView*` true, all `canManage*` false |
| **GDPR Viewer** | Only `canViewReports` true, everything else false |
| **GDPR Admin** | All `canManage*` true except `canManageShareholders` and `canManageTransactions`. `canViewPII` false, `canViewReports` true, `canViewShareholderRegister` false |

Default roles have `isDefault: true` and cannot be deleted (but permissions can be edited).

## Invite Flow

1. Coop admin (with `canManageAdmins`) clicks "Invite admin" on team page
2. Enters email address + selects a role
3. API creates `AdminInvitation` record with unique token, expiry (7 days)
4. System sends email with invite link to `/invite/{token}`
5. Recipient clicks link:
   - If no account: redirected to signup with email pre-filled, token in URL
   - If account exists: redirected to login, token in URL
6. On successful auth, `CoopAdmin` record is created, invitation marked accepted
7. JWT re-issued with updated `coopIds` and permissions

## Authorization Changes

### JWT Payload

Add per-coop permissions:

```typescript
interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  coopIds?: string[];
  coopPermissions?: Record<string, CoopPermissions>; // keyed by coopId
}
```

### New: `PermissionGuard`

Decorator + guard that checks specific permission flags:

```typescript
@RequirePermission('canManageShareholders')
@Get('shareholders')
findAll() {}
```

The guard reads the user's permissions for the current coopId from JWT and checks the required flag.

### PII Masking

- **API-side**: When `canViewPII` is false, mask fields (name, email, phone, address, companyId) in responses. Replace with anonymized values (e.g., "Aandeelhouder #42").
- **Frontend**: Hide/mask PII fields based on permissions from context. Never rely solely on frontend masking.
- **Shareholder register report**: Return 403 when `canViewShareholderRegister` is false.
- **Kapitaaloverzicht transactions**: Return 403 when `canManageTransactions` is false.

## Frontend Pages

### `/dashboard/admin/team`
- List of coop admins with name, email, role
- "Invite admin" button (visible when `canManageAdmins`)
- Edit role / remove admin actions per row
- Pending invitations section with resend/revoke

### `/dashboard/admin/team/roles`
- List of roles with permission summary
- Create new role button
- Edit role: name + permission toggles
- Delete custom roles (with confirmation, reassign admins first)
- Default roles: editable permissions but not deletable

### Invite Dialog
- Email input
- Role selector dropdown
- Send invitation button

## Migration Strategy

1. Create Prisma migration adding `CoopRole`, `AdminInvitation`, modifying `CoopAdmin`
2. Migration seeds default roles for all existing coops
3. Backfill existing `CoopAdmin` records with the "Admin" role (full permissions)
4. Deploy to acc, verify
5. Tag for prod, run `prisma migrate deploy`

## Deployment

- Push to `main` → acc.opencoop.be (auto)
- Version tag `v*` → opencoop.be (prod)
- Update `CHANGELOG.md` with new version entry
