-- ============================================================================
-- Migration: fix_recipient_user_id_column_name
--
-- The previous migration (20260414200000) created the column as
-- `recipient_user_id` (snake_case), but the Prisma schema field is
-- `recipientUserId` without @map, so Prisma was generating queries for a
-- column that does not exist, producing an error on every hourly
-- AdminNotificationsService run. Rename the column + FK constraint to match
-- the camelCase convention used by every other column in this table.
-- ============================================================================

-- Idempotent: skip if a previous partial run already applied the rename.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shareholder_emancipation_tokens'
      AND column_name = 'recipient_user_id'
  ) THEN
    ALTER TABLE "shareholder_emancipation_tokens"
      RENAME COLUMN "recipient_user_id" TO "recipientUserId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shareholder_emancipation_tokens_recipient_user_id_fkey'
  ) THEN
    ALTER TABLE "shareholder_emancipation_tokens"
      RENAME CONSTRAINT "shareholder_emancipation_tokens_recipient_user_id_fkey"
      TO "shareholder_emancipation_tokens_recipientUserId_fkey";
  END IF;
END $$;
