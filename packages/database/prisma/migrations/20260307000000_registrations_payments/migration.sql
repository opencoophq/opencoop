-- Migration: Share + Transaction + old Payment → Registration + new Payment
--
-- This migration preserves all data by converting in-place using SQL.
-- It reuses Transaction IDs as Registration IDs to simplify relinking.
--
-- Steps:
-- 1. Create new enums and registrations table
-- 2. Copy transaction data → registrations (with status/type mapping)
-- 3. Link SELL registrations to their BUY via shareId
-- 4. Transform payments table in-place (add new columns, populate, drop old)
-- 5. Drop old tables and enums

-- ============================================================================
-- STEP 1: Create new types and registrations table
-- ============================================================================

CREATE TYPE "RegistrationType" AS ENUM ('BUY', 'SELL');

CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL,
    "shareholderId" TEXT NOT NULL,
    "shareClassId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "RegistrationType" NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pricePerShare" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "registerDate" TIMESTAMP(3) NOT NULL,
    "isSavings" BOOLEAN NOT NULL DEFAULT false,
    "sellsRegistrationId" TEXT,
    "certificateNumber" TEXT,
    "fromShareholderId" TEXT,
    "toShareholderId" TEXT,
    "channelId" TEXT,
    "processedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "ogmCode" TEXT,
    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 2: Migrate transactions → registrations
-- ============================================================================
-- Reuse transaction.id as registration.id for easy relinking.
-- Skip transactions that have no linked share (no shareClassId).

INSERT INTO "registrations" (
    "id", "coopId", "shareholderId", "shareClassId", "projectId",
    "type", "status", "quantity", "pricePerShare", "totalAmount",
    "registerDate", "certificateNumber",
    "fromShareholderId", "toShareholderId",
    "channelId", "processedByUserId", "processedAt", "rejectionReason",
    "ogmCode", "createdAt", "updatedAt"
)
SELECT
    t.id,
    t."coopId",
    t."shareholderId",
    s."shareClassId",
    s."projectId",
    -- Type mapping
    CASE
        WHEN t.type IN ('PURCHASE', 'TRANSFER_IN') THEN 'BUY'::"RegistrationType"
        WHEN t.type IN ('SALE', 'TRANSFER_OUT') THEN 'SELL'::"RegistrationType"
    END,
    -- Status mapping
    CASE
        WHEN t.status = 'PENDING' THEN 'PENDING'::"RegistrationStatus"
        WHEN t.status = 'AWAITING_PAYMENT' THEN 'PENDING_PAYMENT'::"RegistrationStatus"
        WHEN t.status = 'APPROVED' THEN 'PENDING_PAYMENT'::"RegistrationStatus"
        WHEN t.status = 'COMPLETED' THEN 'COMPLETED'::"RegistrationStatus"
        WHEN t.status = 'REJECTED' THEN 'CANCELLED'::"RegistrationStatus"
        ELSE 'PENDING'::"RegistrationStatus"
    END,
    t.quantity,
    t."pricePerShare",
    t."totalAmount",
    COALESCE(s."purchaseDate", t."createdAt"),
    s."certificateNumber",
    CASE WHEN t.type = 'TRANSFER_IN' THEN t."fromShareholderId" END,
    CASE WHEN t.type = 'TRANSFER_OUT' THEN t."toShareholderId" END,
    t."channelId",
    t."processedByUserId",
    t."processedAt",
    t."rejectionReason",
    p."ogmCode",
    t."createdAt",
    CURRENT_TIMESTAMP
FROM transactions t
JOIN shares s ON s.id = t."shareId"
LEFT JOIN payments p ON p."transactionId" = t.id
WHERE t."shareId" IS NOT NULL;

-- ============================================================================
-- STEP 3: Link SELL registrations to their BUY registrations
-- ============================================================================
-- A SALE transaction references a shareId. The PURCHASE transaction for the
-- same shareId is the original BUY registration.

UPDATE "registrations" sell_reg
SET "sellsRegistrationId" = t_buy.id
FROM transactions t_sell
JOIN transactions t_buy ON t_buy."shareId" = t_sell."shareId"
    AND t_buy.type = 'PURCHASE'
WHERE sell_reg.id = t_sell.id
    AND t_sell.type = 'SALE'
    AND EXISTS (SELECT 1 FROM "registrations" WHERE id = t_buy.id);

-- ============================================================================
-- STEP 4: Transform payments table
-- ============================================================================

-- 4a: Drop incoming foreign keys on payments
ALTER TABLE "bank_transactions" DROP CONSTRAINT IF EXISTS "bank_transactions_matchedPaymentId_fkey";

-- 4b: Drop old indexes
DROP INDEX IF EXISTS "payments_transactionId_key";
DROP INDEX IF EXISTS "payments_ogmCode_key";
DROP INDEX IF EXISTS "bank_transactions_matchedPaymentId_key";

-- 4c: Add new columns (nullable initially)
ALTER TABLE "payments"
    ADD COLUMN "registrationId" TEXT,
    ADD COLUMN "bankDate" TIMESTAMP(3),
    ADD COLUMN "bankTransactionId" TEXT,
    ADD COLUMN "matchedAt" TIMESTAMP(3),
    ADD COLUMN "matchedByUserId" TEXT;

-- 4d: Populate new columns from old data
-- registrationId = transaction id (we reused transaction IDs as registration IDs)
-- bankDate = share.purchaseDate or payment.createdAt
UPDATE "payments" p
SET
    "registrationId" = t.id,
    "bankDate" = COALESCE(s."purchaseDate", p."createdAt"),
    "matchedAt" = COALESCE(s."purchaseDate", p."createdAt")
FROM transactions t
LEFT JOIN shares s ON s.id = t."shareId"
WHERE p."transactionId" = t.id;

-- 4d2: Link bank transactions to payments
-- bank_transactions.matchedPaymentId → payments.bankTransactionId (reverse the FK)
UPDATE "payments" p
SET "bankTransactionId" = bt.id
FROM bank_transactions bt
WHERE bt."matchedPaymentId" = p.id;

-- 4e: Delete orphaned payments (no matching registration)
DELETE FROM "payments"
WHERE "registrationId" IS NULL
   OR "registrationId" NOT IN (SELECT id FROM "registrations");

-- 4f: Set bankDate default for any remaining nulls, then make columns NOT NULL
UPDATE "payments" SET "bankDate" = "createdAt" WHERE "bankDate" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "registrationId" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "bankDate" SET NOT NULL;

-- 4g: Drop old columns
ALTER TABLE "payments"
    DROP COLUMN IF EXISTS "transactionId",
    DROP COLUMN IF EXISTS "ogmCode",
    DROP COLUMN IF EXISTS "method",
    DROP COLUMN IF EXISTS "status",
    DROP COLUMN IF EXISTS "currency",
    DROP COLUMN IF EXISTS "externalReference",
    DROP COLUMN IF EXISTS "updatedAt";

-- 4h: Drop matchedPaymentId from bank_transactions
ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "matchedPaymentId";

-- 4i: Create new indexes and foreign keys on payments
CREATE UNIQUE INDEX "payments_bankTransactionId_key" ON "payments"("bankTransactionId");
CREATE INDEX "payments_registrationId_idx" ON "payments"("registrationId");
CREATE INDEX "payments_bankDate_idx" ON "payments"("bankDate");

ALTER TABLE "payments" ADD CONSTRAINT "payments_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_bankTransactionId_fkey"
    FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_matchedByUserId_fkey"
    FOREIGN KEY ("matchedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- STEP 5: Create indexes and foreign keys on registrations
-- ============================================================================

CREATE UNIQUE INDEX "registrations_ogmCode_key" ON "registrations"("ogmCode");
CREATE INDEX "registrations_coopId_idx" ON "registrations"("coopId");
CREATE INDEX "registrations_shareholderId_idx" ON "registrations"("shareholderId");
CREATE INDEX "registrations_registerDate_idx" ON "registrations"("registerDate");

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_coopId_fkey"
    FOREIGN KEY ("coopId") REFERENCES "coops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_shareholderId_fkey"
    FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_shareClassId_fkey"
    FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_processedByUserId_fkey"
    FOREIGN KEY ("processedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_sellsRegistrationId_fkey"
    FOREIGN KEY ("sellsRegistrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_fromShareholderId_fkey"
    FOREIGN KEY ("fromShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_toShareholderId_fkey"
    FOREIGN KEY ("toShareholderId") REFERENCES "shareholders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- STEP 6: Drop old tables
-- ============================================================================

-- Drop foreign keys from old tables first
ALTER TABLE "shares" DROP CONSTRAINT IF EXISTS "shares_coopId_fkey";
ALTER TABLE "shares" DROP CONSTRAINT IF EXISTS "shares_shareholderId_fkey";
ALTER TABLE "shares" DROP CONSTRAINT IF EXISTS "shares_shareClassId_fkey";
ALTER TABLE "shares" DROP CONSTRAINT IF EXISTS "shares_projectId_fkey";

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_coopId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_channelId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_shareholderId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_shareId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_fromShareholderId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_toShareholderId_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_processedByUserId_fkey";

-- Drop old payment FK
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_transactionId_fkey";

DROP TABLE "shares";
DROP TABLE "transactions";

-- ============================================================================
-- STEP 7: Drop old enums
-- ============================================================================

DROP TYPE "ShareStatus";
DROP TYPE "TransactionType";
DROP TYPE "TransactionStatus";
DROP TYPE "PaymentMethod";
DROP TYPE "PaymentStatus";
