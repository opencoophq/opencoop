# Admin Audit Logging Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete audit trail for all auth events and admin actions, with IP/user-agent tracking.

**Architecture:** Extend the existing `AuditLog` model and `AuditService` with auth event logging, fill gaps in admin CRUD audit coverage, capture IP + user-agent on all events, and add a system-admin auth activity page.

**Approach:** Surgical — add `auditService.log()` calls to each unaudited method. No interceptors or new abstractions.

---

## 1. Auth Event Logging

Add `auditService.log()` calls to all auth methods in `auth.service.ts`:

- **entity**: `'Auth'`
- **actorId**: user ID (null for failed logins)
- **coopId**: `null` (auth events are not coop-scoped)
- **ipAddress**: from `req.ip`
- **userAgent**: from `req.headers['user-agent']`
- **changes**: `{ method, email (for failures), userAgent }`

### Events

| Event | Method | Action | On failure |
|-------|--------|--------|-----------|
| Email+password login | `login()` | `LOGIN` | `LOGIN_FAILED` |
| Magic link verify | `verifyMagicLink()` | `LOGIN` | `LOGIN_FAILED` |
| Google/Apple OAuth | `handleOAuthLogin()` | `LOGIN` | — |
| Passkey auth | `verifyWebAuthn()` | `LOGIN` | `LOGIN_FAILED` |
| MFA verify | `mfaVerify()` | `MFA_VERIFY` | `MFA_VERIFY_FAILED` |
| Register | `register()` | `REGISTER` | — |
| Password change | `changePassword()` | `PASSWORD_CHANGE` | — |
| Password reset | `resetPassword()` | `PASSWORD_RESET` | — |

For failed logins, store the attempted email in the `changes` JSON so it's queryable without an actorId.

## 2. Admin Action Audit Gap Coverage

Add `auditService.log()` to these unaudited admin CRUD operations:

| Operation | entity | action |
|-----------|--------|--------|
| Channel create/update/delete | `Channel` | `CREATE` / `UPDATE` / `DELETE` |
| Share class create/update/delete | `ShareClass` | `CREATE` / `UPDATE` / `DELETE` |
| Project create/update/delete | `Project` | `CREATE` / `UPDATE` / `DELETE` |
| Logo upload/delete | `Coop` | `UPDATE` |
| Dividend create/calculate/mark-paid | `DividendPeriod` | `CREATE` / `UPDATE` |

Use `auditService.diff()` for update operations to capture field-level changes.

## 3. IP + User-Agent Capture

- Add `userAgent String?` column to the `AuditLog` model
- Update `auditService.log()` to accept optional `ipAddress` and `userAgent` parameters
- Pass `req.ip` and `req.headers['user-agent']` from all controller methods (auth + admin)

## 4. Admin Dashboard UI

- **System admin only**: new "Auth Activity" page at `/dashboard/system/auth-logs`
- **API endpoint**: `GET /system/audit-logs/auth` — returns auth events (entity='Auth'), paginated
- **Columns**: Date, User (email), Action, Method, IP, User-Agent
- **Filters**: action type, date range, user email search
- Auth events have `coopId: null` — only visible to system admins, not coop admins
