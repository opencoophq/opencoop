-- CreateEnum
CREATE TYPE "ChargeCardStatus" AS ENUM ('REQUESTED', 'PAID', 'ACTIVE', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeCardBlockReason" AS ENUM ('NO_SHARES', 'LOST', 'ADMIN');

-- AlterTable
ALTER TABLE "coops" ADD COLUMN     "chargeCardFee" DECIMAL(12,2) NOT NULL DEFAULT 6.00,
ADD COLUMN     "chargeCardReplacementFee" DECIMAL(12,2) NOT NULL DEFAULT 12.00,
ADD COLUMN     "chargeCardVatRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
ADD COLUMN     "chargeCardsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "chargeCardId" TEXT,
ALTER COLUMN "registrationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "charge_cards" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "label" TEXT,
    "status" "ChargeCardStatus" NOT NULL DEFAULT 'REQUESTED',
    "blockReason" "ChargeCardBlockReason",
    "ogmCode" TEXT NOT NULL,
    "cardNumber" TEXT,
    "feeInclVat" DECIMAL(12,2) NOT NULL,
    "isReplacement" BOOLEAN NOT NULL DEFAULT false,
    "replacesCardId" TEXT,
    "providerSyncNeeded" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "charge_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_ogmCode_key" ON "charge_cards"("ogmCode");

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_replacesCardId_key" ON "charge_cards"("replacesCardId");

-- CreateIndex
CREATE INDEX "charge_cards_shareholderId_idx" ON "charge_cards"("shareholderId");

-- CreateIndex
CREATE INDEX "charge_cards_coopId_status_idx" ON "charge_cards"("coopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "charge_cards_coopId_cardNumber_key" ON "charge_cards"("coopId", "cardNumber");

-- CreateIndex
CREATE INDEX "payments_chargeCardId_idx" ON "payments"("chargeCardId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_chargeCardId_fkey" FOREIGN KEY ("chargeCardId") REFERENCES "charge_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_cards" ADD CONSTRAINT "charge_cards_replacesCardId_fkey" FOREIGN KEY ("replacesCardId") REFERENCES "charge_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A payment belongs to exactly one target. Prisma cannot express this; it
-- lives only in this migration (db push in CI e2e does not create it).
ALTER TABLE "payments" ADD CONSTRAINT "payments_exactly_one_target_check"
  CHECK (num_nonnulls("registrationId", "chargeCardId") = 1);
