-- Catch-up migration: after this, prisma/migrations produces exactly schema.prisma.
--
-- Several schema changes reached acc and prod by `db push` or by hand, without a
-- migration. A database built from migrations alone was therefore missing tables,
-- columns, an enum value, and had old names and old foreign key actions.
--
-- Every statement is idempotent:
--   * a database built from migrations alone gets the full schema;
--   * a database built with `db push` (or acc/prod, which already have the tables
--     and columns) gets only what it still lacks, and nothing else changes.
-- Nothing in this file deletes a table, a column, or a row.
--
-- Prisma sends the file as one multi-statement query, which PostgreSQL runs as
-- one implicit transaction. If one statement fails, none apply.
--
-- Locks are held until that transaction commits. Statements that would lock a
-- table without changing it are guarded by catalog checks, so acc and prod
-- only lock the tables in sections 5-7. lock_timeout makes the migration fail
-- (and roll back) instead of queueing every query on a table behind a long one.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Enum value
-- ---------------------------------------------------------------------------

-- PG 12+ allows ADD VALUE inside a transaction. The new value cannot be used in
-- the same transaction, and nothing below uses it.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CORRESPONDENCE';

-- ---------------------------------------------------------------------------
-- 2. "WebAuthnCredential" -> webauthn_credentials
-- ---------------------------------------------------------------------------

-- Migration 20260301070000 created the table as "WebAuthnCredential"; the model
-- maps to webauthn_credentials. Rename in place to keep stored passkeys.
-- Only when the old table exists and the new one does not. If both exist, the old
-- table is left alone (it may hold data) and a warning is logged.
DO $$
BEGIN
  IF to_regclass('"WebAuthnCredential"') IS NOT NULL THEN
    IF to_regclass('"webauthn_credentials"') IS NULL THEN
      ALTER TABLE "WebAuthnCredential" RENAME TO "webauthn_credentials";
    ELSE
      RAISE WARNING 'Both "WebAuthnCredential" and webauthn_credentials exist; "WebAuthnCredential" was left untouched.';
    END IF;
  END IF;
END $$;

-- Rename the constraints and indexes that the table rename kept under their old
-- names. Each rename runs only if the old name is still on webauthn_credentials.
-- Renaming the primary key constraint also renames its index.
DO $$
BEGIN
  IF to_regclass('"webauthn_credentials"') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = '"webauthn_credentials"'::regclass
               AND conname = 'WebAuthnCredential_pkey') THEN
    ALTER TABLE "webauthn_credentials"
      RENAME CONSTRAINT "WebAuthnCredential_pkey" TO "webauthn_credentials_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = '"webauthn_credentials"'::regclass
               AND conname = 'WebAuthnCredential_userId_fkey') THEN
    ALTER TABLE "webauthn_credentials"
      RENAME CONSTRAINT "WebAuthnCredential_userId_fkey" TO "webauthn_credentials_userId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index
             WHERE indrelid = '"webauthn_credentials"'::regclass
               AND indexrelid = to_regclass('"WebAuthnCredential_credentialId_key"')) THEN
    ALTER INDEX "WebAuthnCredential_credentialId_key"
      RENAME TO "webauthn_credentials_credentialId_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index
             WHERE indrelid = '"webauthn_credentials"'::regclass
               AND indexrelid = to_regclass('"WebAuthnCredential_userId_idx"')) THEN
    ALTER INDEX "WebAuthnCredential_userId_idx"
      RENAME TO "webauthn_credentials_userId_idx";
  END IF;
END $$;

-- Only for a database that never had either table.
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
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

-- CREATE INDEX IF NOT EXISTS would still lock the table; check the name first.
DO $$
BEGIN
  IF to_regclass('"webauthn_credentials_credentialId_key"') IS NULL THEN
    CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");
  END IF;
  IF to_regclass('"webauthn_credentials_userId_idx"') IS NULL THEN
    CREATE INDEX "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Missing columns
-- ---------------------------------------------------------------------------

-- ADD COLUMN IF NOT EXISTS takes an ACCESS EXCLUSIVE lock on coops and
-- registrations even when the column exists, so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"coops"'::regclass
                 AND attname = 'apiKeyHash' AND NOT attisdropped) THEN
    ALTER TABLE "coops" ADD COLUMN "apiKeyHash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"coops"'::regclass
                 AND attname = 'apiKeyPrefix' AND NOT attisdropped) THEN
    ALTER TABLE "coops" ADD COLUMN "apiKeyPrefix" TEXT;
  END IF;
  -- A constant default is stored in the catalog (PG 11+): no table rewrite.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"registrations"'::regclass
                 AND attname = 'isGift' AND NOT attisdropped) THEN
    ALTER TABLE "registrations" ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"registrations"'::regclass
                 AND attname = 'giftCode' AND NOT attisdropped) THEN
    ALTER TABLE "registrations" ADD COLUMN "giftCode" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"registrations"'::regclass
                 AND attname = 'giftClaimedAt' AND NOT attisdropped) THEN
    ALTER TABLE "registrations" ADD COLUMN "giftClaimedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"registrations"'::regclass
                 AND attname = 'giftClaimedByShareholderId' AND NOT attisdropped) THEN
    ALTER TABLE "registrations" ADD COLUMN "giftClaimedByShareholderId" TEXT;
  END IF;

  IF to_regclass('"coops_apiKeyHash_key"') IS NULL THEN
    CREATE UNIQUE INDEX "coops_apiKeyHash_key" ON "coops"("apiKeyHash");
  END IF;
  IF to_regclass('"registrations_giftCode_key"') IS NULL THEN
    CREATE UNIQUE INDEX "registrations_giftCode_key" ON "registrations"("giftCode");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Missing tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF to_regclass('"refresh_tokens_tokenHash_key"') IS NULL THEN
    CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
  END IF;
  IF to_regclass('"refresh_tokens_userId_idx"') IS NULL THEN
    CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
  END IF;
END $$;

-- acc and prod recorded this table as migration 20260306170000_add_audit_logs,
-- which is not in the repository.
CREATE TABLE IF NOT EXISTS "audit_logs" (
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

DO $$
BEGIN
  IF to_regclass('"audit_logs_entity_entityId_idx"') IS NULL THEN
    CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");
  END IF;
  IF to_regclass('"audit_logs_coopId_idx"') IS NULL THEN
    CREATE INDEX "audit_logs_coopId_idx" ON "audit_logs"("coopId");
  END IF;
  IF to_regclass('"audit_logs_actorId_idx"') IS NULL THEN
    CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");
  END IF;
  IF to_regclass('"audit_logs_createdAt_idx"') IS NULL THEN
    CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Old foreign key name
-- ---------------------------------------------------------------------------

-- Migration 20260414200000 renamed minor_upgrade_tokens and its indexes, but not
-- this foreign key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = '"shareholder_emancipation_tokens"'::regclass
               AND conname = 'minor_upgrade_tokens_shareholderId_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = '"shareholder_emancipation_tokens"'::regclass
                       AND conname = 'shareholder_emancipation_tokens_shareholderId_fkey') THEN
    ALTER TABLE "shareholder_emancipation_tokens"
      RENAME CONSTRAINT "minor_upgrade_tokens_shareholderId_fkey"
      TO "shareholder_emancipation_tokens_shareholderId_fkey";
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Redundant indexes
-- ---------------------------------------------------------------------------

-- Migrations 20260504150000 and 20260505120000 added these; schema.prisma does not
-- declare them. The *_coopAdminId_idx and *_invitationId_idx indexes repeat the
-- first column of the primary key. The *_roleId_idx indexes serve lookups by
-- role on tables with a few rows per coop.
DROP INDEX IF EXISTS "coop_admin_roles_coopAdminId_idx";
DROP INDEX IF EXISTS "coop_admin_roles_roleId_idx";
DROP INDEX IF EXISTS "admin_invitation_roles_invitationId_idx";
DROP INDEX IF EXISTS "admin_invitation_roles_roleId_idx";

-- ---------------------------------------------------------------------------
-- 7. Foreign keys: create the missing ones, fix the actions of the others
-- ---------------------------------------------------------------------------

-- Each block (re)creates one foreign key unless a constraint with that name and
-- the schema's ON DELETE / ON UPDATE actions is already on the table.
-- pg_constraint codes: confdeltype / confupdtype  c = CASCADE, n = SET NULL.
--
-- Behaviour change on acc/prod, if this migration runs there:
-- coop_admins.roleId and admin_invitations.roleId go from ON DELETE RESTRICT to
-- ON DELETE SET NULL (what schema.prisma, `db push`, dev and CI already use).
-- Deleting a role that only the legacy roleId column still points to then
-- succeeds and clears that column, instead of failing with a foreign key error.
-- The four join-table keys gain ON UPDATE CASCADE; ids are never updated.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"webauthn_credentials"'::regclass
                   AND conname = 'webauthn_credentials_userId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "webauthn_credentials" DROP CONSTRAINT IF EXISTS "webauthn_credentials_userId_fkey";
    ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"refresh_tokens"'::regclass
                   AND conname = 'refresh_tokens_userId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_userId_fkey";
    ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"registrations"'::regclass
                   AND conname = 'registrations_giftClaimedByShareholderId_fkey'
                   AND confdeltype = 'n' AND confupdtype = 'c') THEN
    ALTER TABLE "registrations" DROP CONSTRAINT IF EXISTS "registrations_giftClaimedByShareholderId_fkey";
    ALTER TABLE "registrations" ADD CONSTRAINT "registrations_giftClaimedByShareholderId_fkey"
      FOREIGN KEY ("giftClaimedByShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"audit_logs"'::regclass
                   AND conname = 'audit_logs_coopId_fkey'
                   AND confdeltype = 'n' AND confupdtype = 'c') THEN
    ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_coopId_fkey";
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_coopId_fkey"
      FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"audit_logs"'::regclass
                   AND conname = 'audit_logs_actorId_fkey'
                   AND confdeltype = 'n' AND confupdtype = 'c') THEN
    ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actorId_fkey";
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Was ON DELETE RESTRICT (migration 20260306110021).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"coop_admins"'::regclass
                   AND conname = 'coop_admins_roleId_fkey'
                   AND confdeltype = 'n' AND confupdtype = 'c') THEN
    ALTER TABLE "coop_admins" DROP CONSTRAINT IF EXISTS "coop_admins_roleId_fkey";
    ALTER TABLE "coop_admins" ADD CONSTRAINT "coop_admins_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Was ON DELETE RESTRICT (migration 20260306110021).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"admin_invitations"'::regclass
                   AND conname = 'admin_invitations_roleId_fkey'
                   AND confdeltype = 'n' AND confupdtype = 'c') THEN
    ALTER TABLE "admin_invitations" DROP CONSTRAINT IF EXISTS "admin_invitations_roleId_fkey";
    ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The four join-table keys below were ON DELETE CASCADE with no ON UPDATE clause
-- (NO ACTION), from migrations 20260504150000 and 20260505120000.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"coop_admin_roles"'::regclass
                   AND conname = 'coop_admin_roles_coopAdminId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "coop_admin_roles" DROP CONSTRAINT IF EXISTS "coop_admin_roles_coopAdminId_fkey";
    ALTER TABLE "coop_admin_roles" ADD CONSTRAINT "coop_admin_roles_coopAdminId_fkey"
      FOREIGN KEY ("coopAdminId") REFERENCES "coop_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"coop_admin_roles"'::regclass
                   AND conname = 'coop_admin_roles_roleId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "coop_admin_roles" DROP CONSTRAINT IF EXISTS "coop_admin_roles_roleId_fkey";
    ALTER TABLE "coop_admin_roles" ADD CONSTRAINT "coop_admin_roles_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"admin_invitation_roles"'::regclass
                   AND conname = 'admin_invitation_roles_invitationId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "admin_invitation_roles" DROP CONSTRAINT IF EXISTS "admin_invitation_roles_invitationId_fkey";
    ALTER TABLE "admin_invitation_roles" ADD CONSTRAINT "admin_invitation_roles_invitationId_fkey"
      FOREIGN KEY ("invitationId") REFERENCES "admin_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = '"admin_invitation_roles"'::regclass
                   AND conname = 'admin_invitation_roles_roleId_fkey'
                   AND confdeltype = 'c' AND confupdtype = 'c') THEN
    ALTER TABLE "admin_invitation_roles" DROP CONSTRAINT IF EXISTS "admin_invitation_roles_roleId_fkey";
    ALTER TABLE "admin_invitation_roles" ADD CONSTRAINT "admin_invitation_roles_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "coop_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
