-- Multi-role CoopAdmins
--
-- Today: each CoopAdmin has exactly one CoopRole via `roleId`.
-- Now: each CoopAdmin has N roles via the new join table; effective
-- permissions are the union (OR-merge) of every role's permissions
-- with `permissionOverrides` applied on top.
--
-- Migration strategy:
-- 1. Create join table.
-- 2. Backfill from every existing `coop_admins.roleId` (preserves today's
--    one-role-per-admin reality with no behavior change).
-- 3. Make `coop_admins.roleId` nullable. Kept (not dropped) for backward
--    compat — will be dropped in a follow-up migration once we're sure
--    nothing reads it.

-- 1. Join table
CREATE TABLE "coop_admin_roles" (
  "coopAdminId" TEXT NOT NULL,
  "roleId"      TEXT NOT NULL,
  "assignedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coop_admin_roles_pkey" PRIMARY KEY ("coopAdminId", "roleId")
);

CREATE INDEX "coop_admin_roles_coopAdminId_idx" ON "coop_admin_roles" ("coopAdminId");
CREATE INDEX "coop_admin_roles_roleId_idx" ON "coop_admin_roles" ("roleId");

ALTER TABLE "coop_admin_roles"
  ADD CONSTRAINT "coop_admin_roles_coopAdminId_fkey"
    FOREIGN KEY ("coopAdminId") REFERENCES "coop_admins"("id") ON DELETE CASCADE;

ALTER TABLE "coop_admin_roles"
  ADD CONSTRAINT "coop_admin_roles_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE;

-- 2. Backfill: every existing CoopAdmin gets a single CoopAdminRole row
--    matching their current single roleId. After this, the new code can
--    read exclusively from `coop_admin_roles` and ignore `roleId`.
INSERT INTO "coop_admin_roles" ("coopAdminId", "roleId", "assignedAt")
SELECT "id", "roleId", "createdAt"
FROM "coop_admins"
WHERE "roleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "coop_admin_roles" car
    WHERE car."coopAdminId" = "coop_admins"."id" AND car."roleId" = "coop_admins"."roleId"
  );

-- 3. Make `roleId` nullable. Kept on the row (not dropped) so a rollback
--    of the application code can still read the old single-role link if
--    needed. Drop in a follow-up migration after the rollout has stuck.
ALTER TABLE "coop_admins" ALTER COLUMN "roleId" DROP NOT NULL;
