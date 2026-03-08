-- CreateEnum
CREATE TYPE "PontoConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterTable: add Ponto fields to coops
ALTER TABLE "coops" ADD COLUMN "pontoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "coops" ADD COLUMN "autoMatchPayments" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: add pontoTransactionId to bank_transactions
ALTER TABLE "bank_transactions" ADD COLUMN "pontoTransactionId" TEXT;
CREATE UNIQUE INDEX "bank_transactions_pontoTransactionId_key" ON "bank_transactions"("pontoTransactionId");

-- AlterTable: make bankImportId nullable on bank_transactions (for Ponto-sourced transactions)
ALTER TABLE "bank_transactions" ALTER COLUMN "bankImportId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ponto_connections" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "pontoAccountId" TEXT,
    "pontoOrganizationId" TEXT,
    "iban" TEXT,
    "bankName" TEXT,
    "status" "PontoConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "authExpiresAt" TIMESTAMP(3),
    "expiryNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ponto_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ponto_connections_coopId_key" ON "ponto_connections"("coopId");

-- AddForeignKey
ALTER TABLE "ponto_connections" ADD CONSTRAINT "ponto_connections_coopId_fkey" FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
