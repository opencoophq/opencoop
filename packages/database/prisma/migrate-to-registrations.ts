/**
 * Production migration script: Share + Transaction + Payment → Registration + Payment
 *
 * This script migrates production data from the old model to the new model.
 * It should be run AFTER the Prisma migration creates the new tables but BEFORE
 * the old tables are dropped.
 *
 * Strategy:
 * 1. For each Transaction (PURCHASE), create a Registration (BUY)
 * 2. For each Transaction (SALE), create a Registration (SELL)
 * 3. For each old Payment, create a new Payment linked to the Registration
 * 4. Transfer certificate numbers from Share records to Registration records
 * 5. Link SELL registrations to their corresponding BUY via sellsRegistrationId
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx packages/database/prisma/migrate-to-registrations.ts
 *
 * Run with --dry-run to preview without writing:
 *   DATABASE_URL="postgresql://..." npx tsx packages/database/prisma/migrate-to-registrations.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// Status mapping: old TransactionStatus → new RegistrationStatus
function mapStatus(oldStatus: string): string {
  switch (oldStatus) {
    case 'PENDING': return 'PENDING';
    case 'AWAITING_PAYMENT': return 'PENDING_PAYMENT';
    case 'APPROVED': return 'PENDING_PAYMENT';
    case 'COMPLETED': return 'COMPLETED';
    case 'REJECTED': return 'CANCELLED';
    default: return 'PENDING';
  }
}

// Type mapping: old TransactionType → new RegistrationType
function mapType(oldType: string): string {
  switch (oldType) {
    case 'PURCHASE': return 'BUY';
    case 'SALE': return 'SELL';
    case 'TRANSFER_IN': return 'BUY';
    case 'TRANSFER_OUT': return 'SELL';
    default: return 'BUY';
  }
}

async function main() {
  console.log(`\nMigration: Share + Transaction → Registration + Payment`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  // Check if registrations already exist (idempotency)
  const existingRegs = await prisma.registration.count();
  if (existingRegs > 0) {
    console.log(`  Found ${existingRegs} existing registrations — aborting to avoid duplicates.`);
    console.log(`  If you need to re-run, delete existing registrations first.`);
    return;
  }

  // Fetch all old transactions with their share and payment data
  const oldTransactions = await prisma.$queryRaw<Array<{
    id: string;
    coopId: string;
    type: string;
    status: string;
    createdAt: Date;
    shareholderId: string;
    shareId: string | null;
    quantity: number;
    pricePerShare: string;
    totalAmount: string;
    fromShareholderId: string | null;
    toShareholderId: string | null;
    channelId: string | null;
    processedByUserId: string | null;
    processedAt: Date | null;
    rejectionReason: string | null;
    // Share fields
    shareClassId: string | null;
    projectId: string | null;
    certificateNumber: string | null;
    purchaseDate: Date | null;
    paymentDate: Date | null;
    // Payment fields
    paymentId: string | null;
    paymentAmount: string | null;
    paymentStatus: string | null;
    ogmCode: string | null;
    bankTransactionId: string | null;
  }>>`
    SELECT
      t.id, t."coopId", t.type, t.status, t."createdAt",
      t."shareholderId", t."shareId", t.quantity,
      t."pricePerShare"::text, t."totalAmount"::text,
      t."fromShareholderId", t."toShareholderId",
      t."channelId", t."processedByUserId", t."processedAt",
      t."rejectionReason",
      s."shareClassId", s."projectId", s."certificateNumber",
      s."purchaseDate", s."paymentDate",
      p.id AS "paymentId", p.amount::text AS "paymentAmount",
      p.status AS "paymentStatus", p."ogmCode",
      bt."id" AS "bankTransactionId"
    FROM transactions t
    LEFT JOIN shares s ON s.id = t."shareId"
    LEFT JOIN payments p ON p."transactionId" = t.id
    LEFT JOIN bank_transactions bt ON bt."matchedPaymentId" = p.id
    ORDER BY t."createdAt" ASC
  `;

  console.log(`  Found ${oldTransactions.length} transactions to migrate`);

  if (DRY_RUN) {
    console.log(`\n  Dry run summary:`);
    const types = oldTransactions.reduce((acc, t) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    for (const [type, count] of Object.entries(types)) {
      console.log(`    ${type}: ${count}`);
    }
    console.log(`\n  Would create ${oldTransactions.length} registrations`);
    console.log(`  Would create ${oldTransactions.filter(t => t.paymentId).length} payments`);
    return;
  }

  // I5: Wrap entire migration in a transaction for atomicity
  await prisma.$transaction(async (tx) => {
    // Track old transaction ID → new registration ID for SELL → BUY linking
    const txToRegMap = new Map<string, string>();
    // I4: Track shareId → BUY registration ID for linking SELLs
    const shareToRegMap = new Map<string, string>();

    let regCount = 0;
    let payCount = 0;

    for (const oldTx of oldTransactions) {
      const newType = mapType(oldTx.type);
      const newStatus = mapStatus(oldTx.status);

      const shareClassId = oldTx.shareClassId;
      if (!shareClassId) {
        console.warn(`  WARN: Transaction ${oldTx.id} has no shareClassId — skipping`);
        continue;
      }

      const registration = await tx.registration.create({
        data: {
          coopId: oldTx.coopId,
          shareholderId: oldTx.shareholderId,
          shareClassId,
          projectId: oldTx.projectId,
          type: newType as 'BUY' | 'SELL',
          status: newStatus as 'PENDING' | 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
          quantity: oldTx.quantity,
          pricePerShare: parseFloat(oldTx.pricePerShare),
          totalAmount: parseFloat(oldTx.totalAmount),
          registerDate: oldTx.purchaseDate || oldTx.createdAt,
          ogmCode: oldTx.ogmCode || null,
          certificateNumber: oldTx.certificateNumber || null,
          fromShareholderId: oldTx.type === 'TRANSFER_IN' ? oldTx.fromShareholderId : null,
          toShareholderId: oldTx.type === 'TRANSFER_OUT' ? oldTx.toShareholderId : null,
          channelId: oldTx.channelId,
          processedByUserId: oldTx.processedByUserId,
          processedAt: oldTx.processedAt,
          rejectionReason: oldTx.rejectionReason,
          createdAt: oldTx.createdAt,
        },
      });

      txToRegMap.set(oldTx.id, registration.id);

      // Track which share's BUY registration this is (for SELL linking)
      if (newType === 'BUY' && oldTx.shareId) {
        shareToRegMap.set(oldTx.shareId, registration.id);
      }

      regCount++;

      // Create payment if the old payment exists and was confirmed (or for completed transactions)
      if (oldTx.paymentId && oldTx.paymentAmount) {
        const paymentAmount = parseFloat(oldTx.paymentAmount);
        const isPaymentConfirmed = oldTx.paymentStatus === 'CONFIRMED' || oldTx.paymentStatus === 'MATCHED';

        if (isPaymentConfirmed || newStatus === 'COMPLETED') {
          await tx.payment.create({
            data: {
              registrationId: registration.id,
              coopId: oldTx.coopId,
              amount: paymentAmount,
              bankDate: oldTx.paymentDate || oldTx.createdAt,
              bankTransactionId: oldTx.bankTransactionId || null,
              matchedAt: oldTx.paymentDate || oldTx.createdAt,
              createdAt: oldTx.createdAt,
            },
          });
          payCount++;
        }
      }
    }

    console.log(`  Created ${regCount} registrations`);
    console.log(`  Created ${payCount} payments`);

    // I4: Second pass — link SELL registrations to their corresponding BUY
    // Old SALE transactions reference a shareId; the PURCHASE for that share created the BUY registration.
    let linkedCount = 0;
    for (const oldTx of oldTransactions) {
      if (oldTx.type === 'SALE' && oldTx.shareId) {
        const sellRegId = txToRegMap.get(oldTx.id);
        const buyRegId = shareToRegMap.get(oldTx.shareId);
        if (sellRegId && buyRegId) {
          await tx.registration.update({
            where: { id: sellRegId },
            data: { sellsRegistrationId: buyRegId },
          });
          linkedCount++;
        }
      }
    }
    console.log(`  Linked ${linkedCount} SELL registrations to their BUY`);
  }, { timeout: 300000 }); // 5-minute timeout for large datasets

  // Validate: compare total capital between old and new
  const [oldCapital] = await prisma.$queryRaw<[{ total: string }]>`
    SELECT COALESCE(SUM(
      CASE WHEN type = 'PURCHASE' THEN "totalAmount"
           WHEN type = 'SALE' THEN -"totalAmount"
           ELSE 0 END
    ), 0)::text AS total
    FROM transactions
    WHERE status = 'COMPLETED'
      AND type IN ('PURCHASE', 'SALE')
  `;

  const [newCapital] = await prisma.$queryRaw<[{ total: string }]>`
    SELECT COALESCE(
      SUM(CASE WHEN r.type = 'BUY' THEN p.amount ELSE -p.amount END),
      0
    )::text AS total
    FROM payments p
    JOIN registrations r ON r.id = p."registrationId"
    WHERE r.status IN ('ACTIVE', 'COMPLETED')
  `;

  console.log(`\n  Validation:`);
  console.log(`    Old capital (from transactions): €${oldCapital.total}`);
  console.log(`    New capital (from payments):     €${newCapital.total}`);

  if (oldCapital.total === newCapital.total) {
    console.log(`    ✓ Capital matches!`);
  } else {
    console.log(`    ✗ MISMATCH — investigate before dropping old tables!`);
  }

  console.log(`\nMigration complete.`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
