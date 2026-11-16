-- CreateEnum
CREATE TYPE "TransferReason" AS ENUM ('INHERITANCE', 'SALE', 'GIFT', 'OTHER');

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "shareTransferId" TEXT;

-- AlterTable
ALTER TABLE "shareholders" ADD COLUMN     "deceasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "share_transfers" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "fromShareholderId" TEXT NOT NULL,
    "toShareholderId" TEXT NOT NULL,
    "shareClassId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "reason" "TransferReason" NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "markedFromAsDeceased" BOOLEAN NOT NULL DEFAULT false,
    "processedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "share_transfers_coopId_idx" ON "share_transfers"("coopId");

-- CreateIndex
CREATE INDEX "share_transfers_fromShareholderId_idx" ON "share_transfers"("fromShareholderId");

-- CreateIndex
CREATE INDEX "share_transfers_toShareholderId_idx" ON "share_transfers"("toShareholderId");

-- CreateIndex
CREATE UNIQUE INDEX "share_transfers_coopId_idempotencyKey_key" ON "share_transfers"("coopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "registrations_shareTransferId_idx" ON "registrations"("shareTransferId");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_shareTransferId_fkey" FOREIGN KEY ("shareTransferId") REFERENCES "share_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_transfers" ADD CONSTRAINT "share_transfers_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_transfers" ADD CONSTRAINT "share_transfers_fromShareholderId_fkey" FOREIGN KEY ("fromShareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_transfers" ADD CONSTRAINT "share_transfers_toShareholderId_fkey" FOREIGN KEY ("toShareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_transfers" ADD CONSTRAINT "share_transfers_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_transfers" ADD CONSTRAINT "share_transfers_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
