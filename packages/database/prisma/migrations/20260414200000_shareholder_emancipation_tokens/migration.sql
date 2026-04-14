-- ============================================================================
-- Migration: shareholder_emancipation_tokens
--
-- Renames `minor_upgrade_tokens` to `shareholder_emancipation_tokens` IN PLACE
-- to preserve all existing minor-upgrade rows. Adds:
--   - `reason` enum column (backfilled to MINOR_COMING_OF_AGE for existing rows)
--   - `recipient_user_id` FK column (nullable, links to the user who receives the email)
--
-- Manual edits vs Prisma auto-generated:
--   Prisma would DROP + CREATE the table (data loss). We RENAME + ALTER instead.
-- ============================================================================

-- Create the new enum type
CREATE TYPE "EmancipationReason" AS ENUM ('MINOR_COMING_OF_AGE', 'HOUSEHOLD_SPLIT');

-- Rename the table in place (preserves all existing data)
ALTER TABLE "minor_upgrade_tokens" RENAME TO "shareholder_emancipation_tokens";

-- Add reason column with a default so existing rows get backfilled automatically
ALTER TABLE "shareholder_emancipation_tokens"
  ADD COLUMN "reason" "EmancipationReason" NOT NULL DEFAULT 'MINOR_COMING_OF_AGE';

-- Drop the default now that existing rows are backfilled
ALTER TABLE "shareholder_emancipation_tokens"
  ALTER COLUMN "reason" DROP DEFAULT;

-- Add the optional recipient_user_id column
ALTER TABLE "shareholder_emancipation_tokens"
  ADD COLUMN "recipient_user_id" TEXT;

-- Add foreign key constraint for recipient_user_id → users.id (SET NULL on delete)
ALTER TABLE "shareholder_emancipation_tokens"
  ADD CONSTRAINT "shareholder_emancipation_tokens_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
