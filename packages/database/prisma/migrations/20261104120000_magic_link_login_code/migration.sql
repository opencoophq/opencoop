-- Additive columns for the email one-time code that shares this row with the
-- magic link. Existing links stay valid: codeHash/codeSalt stay null, and
-- failedAttempts defaults to 0 so an in-flight link is not locked.
ALTER TABLE "magic_link_tokens" ADD COLUMN "codeHash" TEXT;
ALTER TABLE "magic_link_tokens" ADD COLUMN "codeSalt" TEXT;
ALTER TABLE "magic_link_tokens" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
