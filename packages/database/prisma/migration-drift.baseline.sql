-- Known drift between prisma/migrations and schema.prisma as of 2026-11-22.
-- CI fails when this changes. It may only shrink; never add to it.
-- Regenerate: SHADOW_DATABASE_URL=<shadow url> bash packages/database/scripts/check-migration-drift.sh --update
-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CORRESPONDENCE';

-- DropForeignKey
ALTER TABLE "WebAuthnCredential" DROP CONSTRAINT "WebAuthnCredential_userId_fkey";

-- DropForeignKey
ALTER TABLE "admin_invitation_roles" DROP CONSTRAINT "admin_invitation_roles_invitationId_fkey";

-- DropForeignKey
ALTER TABLE "admin_invitation_roles" DROP CONSTRAINT "admin_invitation_roles_roleId_fkey";

-- DropForeignKey
ALTER TABLE "admin_invitations" DROP CONSTRAINT "admin_invitations_roleId_fkey";

-- DropForeignKey
ALTER TABLE "coop_admin_roles" DROP CONSTRAINT "coop_admin_roles_coopAdminId_fkey";

-- DropForeignKey
ALTER TABLE "coop_admin_roles" DROP CONSTRAINT "coop_admin_roles_roleId_fkey";

-- DropForeignKey
ALTER TABLE "coop_admins" DROP CONSTRAINT "coop_admins_roleId_fkey";

-- DropIndex
DROP INDEX "admin_invitation_roles_invitationId_idx";

-- DropIndex
DROP INDEX "admin_invitation_roles_roleId_idx";

-- DropIndex
DROP INDEX "coop_admin_roles_coopAdminId_idx";

-- DropIndex
DROP INDEX "coop_admin_roles_roleId_idx";

-- AlterTable
ALTER TABLE "coops" ADD COLUMN     "apiKeyHash" TEXT,
ADD COLUMN     "apiKeyPrefix" TEXT;

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "giftClaimedAt" TIMESTAMP(3),
ADD COLUMN     "giftClaimedByShareholderId" TEXT,
ADD COLUMN     "giftCode" TEXT,
ADD COLUMN     "isGift" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "WebAuthnCredential";

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" BYTEA NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "credentialDeviceType" TEXT NOT NULL,
    "credentialBackedUp" BOOLEAN NOT NULL,
    "transports" TEXT[],
    "friendlyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "coopId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");

-- CreateIndex
CREATE INDEX "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_coopId_idx" ON "audit_logs"("coopId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "coops_apiKeyHash_key" ON "coops"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_giftCode_key" ON "registrations"("giftCode");

-- RenameForeignKey
ALTER TABLE "shareholder_emancipation_tokens" RENAME CONSTRAINT "minor_upgrade_tokens_shareholderId_fkey" TO "shareholder_emancipation_tokens_shareholderId_fkey";

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_admins" ADD CONSTRAINT "coop_admins_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_admin_roles" ADD CONSTRAINT "coop_admin_roles_coopAdminId_fkey" FOREIGN KEY ("coopAdminId") REFERENCES "coop_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coop_admin_roles" ADD CONSTRAINT "coop_admin_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitation_roles" ADD CONSTRAINT "admin_invitation_roles_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "admin_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitation_roles" ADD CONSTRAINT "admin_invitation_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_giftClaimedByShareholderId_fkey" FOREIGN KEY ("giftClaimedByShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

