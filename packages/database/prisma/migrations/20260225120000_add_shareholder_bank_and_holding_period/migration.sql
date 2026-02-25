-- AlterTable
ALTER TABLE "shareholders" ADD COLUMN "bankIban" TEXT,
ADD COLUMN "bankBic" TEXT;

-- AlterTable
ALTER TABLE "coops" ADD COLUMN "minimumHoldingPeriod" INTEGER NOT NULL DEFAULT 0;
