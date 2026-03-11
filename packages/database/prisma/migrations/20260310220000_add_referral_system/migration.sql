-- AlterTable: Add referral fields to shareholders
ALTER TABLE "shareholders" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "shareholders" ADD COLUMN "referredByShareholderId" TEXT;

-- CreateIndex: Unique index on referral code
CREATE UNIQUE INDEX "shareholders_referralCode_key" ON "shareholders"("referralCode");

-- AddForeignKey: referredByShareholderId -> shareholders
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_referredByShareholderId_fkey" FOREIGN KEY ("referredByShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Add referral attribution to registrations
ALTER TABLE "registrations" ADD COLUMN "referralShareholderId" TEXT;

-- AddForeignKey: referralShareholderId -> shareholders
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_referralShareholderId_fkey" FOREIGN KEY ("referralShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: Generate referral codes for all existing ACTIVE shareholders
-- Format: BRG-XXXXX (5 alphanumeric chars = 60M+ combinations)
-- Uses a deterministic approach with random-looking output from md5 hash
UPDATE "shareholders"
SET "referralCode" = 'BRG-' || UPPER(SUBSTRING(md5(id || '-referral') FROM 1 FOR 5))
WHERE status = 'ACTIVE' AND "referralCode" IS NULL;
