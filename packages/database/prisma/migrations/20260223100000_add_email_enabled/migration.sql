-- AlterTable
ALTER TABLE "coops" ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Disable email for the demo coop
UPDATE "coops" SET "emailEnabled" = false WHERE "slug" = 'demo';
