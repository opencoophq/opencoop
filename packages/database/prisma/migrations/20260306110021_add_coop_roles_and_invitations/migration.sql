-- CreateTable
CREATE TABLE "coop_roles" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coop_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_invitations" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coop_roles_coopId_name_key" ON "coop_roles"("coopId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_token_key" ON "admin_invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_coopId_email_key" ON "admin_invitations"("coopId", "email");

-- AddForeignKey (coop_roles -> coops)
ALTER TABLE "coop_roles" ADD CONSTRAINT "coop_roles_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (admin_invitations -> coops)
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (admin_invitations -> coop_roles)
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- Add roleId column as nullable first
ALTER TABLE "coop_admins" ADD COLUMN "roleId" TEXT;

-- Backfill existing coop_admins with the "Admin" role
UPDATE "coop_admins" ca
SET "roleId" = cr.id
FROM "coop_roles" cr
WHERE cr."coopId" = ca."coopId" AND cr.name = 'Admin';

-- Now make roleId NOT NULL
ALTER TABLE "coop_admins" ALTER COLUMN "roleId" SET NOT NULL;

-- AddForeignKey (coop_admins -> coop_roles)
ALTER TABLE "coop_admins" ADD CONSTRAINT "coop_admins_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
