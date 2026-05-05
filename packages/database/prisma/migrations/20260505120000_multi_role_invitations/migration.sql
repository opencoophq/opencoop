-- Multi-role admin invitations
--
-- Mirrors the v0.8.26 migration for `coop_admins`: invitations move from
-- a single `roleId` FK to a join table; on acceptance, each invitation
-- role becomes a `CoopAdminRole` for the new admin.
--
-- 1. Create join table.
-- 2. Backfill from every existing `admin_invitations.roleId` so pending
--    invitations keep working with no behavior change.
-- 3. Make `admin_invitations.roleId` nullable. Kept (not dropped) for
--    rollback safety.

CREATE TABLE "admin_invitation_roles" (
  "invitationId" TEXT NOT NULL,
  "roleId"       TEXT NOT NULL,

  CONSTRAINT "admin_invitation_roles_pkey" PRIMARY KEY ("invitationId", "roleId")
);

CREATE INDEX "admin_invitation_roles_invitationId_idx" ON "admin_invitation_roles" ("invitationId");
CREATE INDEX "admin_invitation_roles_roleId_idx" ON "admin_invitation_roles" ("roleId");

ALTER TABLE "admin_invitation_roles"
  ADD CONSTRAINT "admin_invitation_roles_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "admin_invitations"("id") ON DELETE CASCADE;

ALTER TABLE "admin_invitation_roles"
  ADD CONSTRAINT "admin_invitation_roles_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE;

INSERT INTO "admin_invitation_roles" ("invitationId", "roleId")
SELECT "id", "roleId"
FROM "admin_invitations"
WHERE "roleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "admin_invitation_roles" air
    WHERE air."invitationId" = "admin_invitations"."id" AND air."roleId" = "admin_invitations"."roleId"
  );

ALTER TABLE "admin_invitations" ALTER COLUMN "roleId" DROP NOT NULL;
