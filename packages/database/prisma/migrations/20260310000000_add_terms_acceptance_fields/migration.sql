-- AlterTable
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN "coopTermsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "coopTermsVersion" TEXT,
ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "privacyVersion" TEXT;
