# Audit History — Design

**Date:** 2026-03-04
**Status:** Approved

## Overview

Add a generic audit log to track all data changes across OpenCoop. Covers shareholders, users, and coop settings. Service-level logging approach — explicit `auditService.log()` calls at each update path.

## Data Model

New `AuditLog` Prisma model:

```prisma
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

### Changes JSON format

```json
[
  { "field": "bankIban", "oldValue": "BE68...", "newValue": "BE71..." },
  { "field": "address.city", "oldValue": "Gent", "newValue": "Antwerpen" }
]
```

### Sensitive fields (masked as `***`)

`passwordHash`, `mfaSecret`, `mfaRecoveryCodes`, `nationalId`, `smtpPass`, `graphClientSecret`

## AuditService

Shared `AuditModule` exporting `AuditService` with:

- `log(params)` — creates audit entry, auto-masks sensitive fields
- `diff(oldObj, newObj)` — compares two objects and returns changed fields array

## Update Paths to Instrument

| Service/Controller | Method | Entity |
|---|---|---|
| `shareholders.service.ts` | `update()` | Shareholder |
| `shareholder-actions.controller.ts` | `updateBankDetails()` | Shareholder |
| `shareholder-actions.controller.ts` | `updateProfile()` | Shareholder |
| `shareholders.service.ts` | `create()` | Shareholder |
| `auth.service.ts` | `changePassword()` | User |
| `auth.service.ts` | `mfaEnable/Disable()` | User |
| `users.service.ts` | `updatePreferences()` | User |
| `coops.service.ts` | `update()` | Coop |
| `coops.service.ts` | `updateBranding()` | Coop |

## API Endpoints

- `GET /admin/coops/:coopId/audit-logs` — coop-scoped, coop admins. Query params: `entity`, `entityId`, `page`, `limit`
- `GET /system/audit-logs` — global, system admins. Query params: `coopId`, `entity`, `entityId`, `actorId`, `page`, `limit`

## Frontend

- **Shareholder detail page** (admin): "History" tab with timeline of changes
- **Coop settings page** (admin): "Recent changes" section
- **System admin**: Global audit log at `/dashboard/system/audit` with filters

## Visibility

- Coop admins see audit history for their coop
- System admins see global audit log across all coops
- Shareholders do not see audit history

## Design Decisions

- **Service-level logging** over Prisma middleware: avoids async context issues for actor identification, explicit control over what's logged
- **Sensitive field masking**: log the fact that a change occurred, but mask old/new values
- **Append-only**: audit entries cannot be edited or deleted via the API
