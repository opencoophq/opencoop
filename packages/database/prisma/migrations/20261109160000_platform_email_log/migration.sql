-- Platform SMTP mail (login codes, magic links, password resets, and the
-- other sendPlatformEmail callers) is recorded on email_logs.
--
-- Additive and safe on PostgreSQL 16:
--   * New EmailStatus values are appended. Existing QUEUED/SENT/FAILED rows
--     are unchanged, and this file does not write the new values. ADD VALUE
--     is allowed inside the migrate transaction on PostgreSQL 12+ when the
--     new value is not used in the same transaction.
--   * coopId becomes nullable. Existing rows keep their coopId. The foreign
--     key stays, so a non-null coopId must still reference a coop and
--     ON DELETE CASCADE still removes those rows when the coop is deleted.
--     Rows with a null coopId are platform mail and are not cascade-deleted.
--   * providerMessageId and smtpResponse are nullable, with no default and
--     no rewrite of existing rows.
--   * The recipient index is a normal CREATE INDEX, same as email_logs_coopId_idx.
--     It locks writes on email_logs only for the build. The table is pruned
--     (EMAIL_LOG_RETENTION_DAYS, default 180) and is not rewritten.

ALTER TYPE "EmailStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "EmailStatus" ADD VALUE 'REJECTED';
ALTER TYPE "EmailStatus" ADD VALUE 'ERROR';

ALTER TABLE "email_logs" ALTER COLUMN "coopId" DROP NOT NULL;

ALTER TABLE "email_logs" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "email_logs" ADD COLUMN "smtpResponse" TEXT;

CREATE INDEX "email_logs_recipientEmail_idx" ON "email_logs"("recipientEmail");
