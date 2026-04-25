-- Per-coop convocation notice period (defaults to 15, the WVV norm).
ALTER TABLE "coops"
  ADD COLUMN "minConvocationDays" INTEGER NOT NULL DEFAULT 15;

-- Per-shareholder convocation send tracking. Lets a partial-failure send be
-- retried safely: subsequent send() calls only target attendances where
-- this column is NULL, so already-mailed inboxes never get a duplicate.
ALTER TABLE "meeting_attendances"
  ADD COLUMN "convocationSentAt" TIMESTAMP(3);

-- Bronsgroen statuten (Art. 22) require 14-day notice, not the WVV-default 15.
UPDATE "coops" SET "minConvocationDays" = 14 WHERE "slug" = 'bronsgroen';

-- Per-meeting custom convocation email content. Both optional; the service
-- falls back to the built-in template when these are NULL.
ALTER TABLE "meetings"
  ADD COLUMN "customSubject" TEXT,
  ADD COLUMN "customBody" TEXT;
