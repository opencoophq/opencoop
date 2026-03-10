-- AlterTable
ALTER TABLE "coops" ADD COLUMN "legalForm" TEXT;
ALTER TABLE "coops" ADD COLUMN "foundedDate" TEXT;
ALTER TABLE "coops" ADD COLUMN "certificateSignatory" TEXT;
ALTER TABLE "coops" ADD COLUMN "coopAddress" JSONB;
ALTER TABLE "coops" ADD COLUMN "coopPhone" TEXT;
ALTER TABLE "coops" ADD COLUMN "coopEmail" TEXT;
ALTER TABLE "coops" ADD COLUMN "coopWebsite" TEXT;
ALTER TABLE "coops" ADD COLUMN "vatNumber" TEXT;
ALTER TABLE "coops" ADD COLUMN "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "shareholders" ADD COLUMN "memberNumber" INTEGER;
