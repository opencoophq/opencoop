/**
 * Fix createdAt timestamps for Bronsgroen migration.
 *
 * The initial import left createdAt as now() on all records.
 * This script updates them to match historical dates from the CSV:
 * - Shareholders: earliest registration/payment date from their register entries
 * - Shares: registration date (or payment date as fallback)
 * - Transactions: same date as the corresponding share
 *
 * Usage: same SSH tunnel pattern as migrate-bronsgroen.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();
const COOP_SLUG = 'bronsgroen';
const DOWNLOADS = path.join(process.env.HOME || '~', 'Downloads');

function parseDate(s: string): Date | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split('-');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function readCsv(filename: string): Record<string, string>[] {
  const content = fs.readFileSync(path.join(DOWNLOADS, filename), 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, bom: true });
}

async function main() {
  console.log('=== Fix Bronsgroen Dates ===\n');

  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) {
    console.error('Coop not found');
    process.exit(1);
  }

  const registerRows = readCsv('Aandelenregister-3.csv');
  const shareholderRows = readCsv('Coöperanten-2.csv');

  // Build map: CSV shareholder ID → earliest date
  const earliestDateByCsvId: Record<string, Date> = {};
  for (const r of registerRows) {
    const sid = r['Coöperant naam: Id']?.trim();
    if (!sid) continue;
    const regDate = parseDate(r['Datum registratie']);
    const payDate = parseDate(r['Datum Storting']);
    const date = regDate || payDate;
    if (!date) continue;
    if (!earliestDateByCsvId[sid] || date < earliestDateByCsvId[sid]) {
      earliestDateByCsvId[sid] = date;
    }
  }

  // Build map: CSV shareholder ID → email (to match DB records)
  // We need to match by email since we don't store CSV IDs
  // But emails were modified for duplicates. Instead, match by firstName + lastName + coopId
  const shareholders = await prisma.shareholder.findMany({
    where: { coopId: coop.id },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  // Build lookup: "firstName|lastName" → shareholder records (may have dupes)
  const shByName: Record<string, typeof shareholders> = {};
  for (const sh of shareholders) {
    const key = `${sh.firstName || ''}|${sh.lastName || ''}`;
    if (!shByName[key]) shByName[key] = [];
    shByName[key].push(sh);
  }

  // Map CSV rows to DB shareholders
  const csvIdToDbId: Record<string, string> = {};
  for (const row of shareholderRows) {
    const csvId = row['Id']?.trim();
    if (!csvId) continue;
    const firstName = row['Voornaam']?.trim() || '';
    const lastName = row['Naam']?.trim() || '';
    const key = `${firstName}|${lastName}`;
    const candidates = shByName[key] || [];
    if (candidates.length === 1) {
      csvIdToDbId[csvId] = candidates[0].id;
    } else if (candidates.length > 1) {
      // Match by email (original or modified)
      const csvEmail = row['Email']?.trim()?.toLowerCase() || null;
      const match = candidates.find(
        (c) => c.email && csvEmail && (c.email === csvEmail || c.email.startsWith(csvEmail.split('@')[0])),
      );
      if (match) {
        csvIdToDbId[csvId] = match.id;
      } else if (candidates.length > 0) {
        // Just take first unmatched one
        const used = new Set(Object.values(csvIdToDbId));
        const unused = candidates.find((c) => !used.has(c.id));
        if (unused) csvIdToDbId[csvId] = unused.id;
      }
    }
  }

  console.log(`Mapped ${Object.keys(csvIdToDbId).length} of ${shareholderRows.length} shareholders`);

  // 1. Fix shareholder createdAt
  let shFixed = 0;
  for (const [csvId, dbId] of Object.entries(csvIdToDbId)) {
    const date = earliestDateByCsvId[csvId];
    if (!date) continue;
    await prisma.shareholder.update({
      where: { id: dbId },
      data: { createdAt: date },
    });
    shFixed++;
  }
  console.log(`Shareholders createdAt fixed: ${shFixed}`);

  // 2. Fix shares and transactions createdAt
  // Get all shares for this coop with their transactions
  const shares = await prisma.share.findMany({
    where: { coopId: coop.id },
    select: { id: true, shareholderId: true, purchaseDate: true },
  });

  let sharesFixed = 0;
  let txFixed = 0;
  for (const share of shares) {
    // Use purchaseDate as createdAt (already set correctly from CSV)
    await prisma.share.update({
      where: { id: share.id },
      data: { createdAt: share.purchaseDate },
    });
    sharesFixed++;

    // Fix transactions linked to this share
    const txs = await prisma.transaction.findMany({
      where: { shareId: share.id },
      select: { id: true, type: true, processedAt: true },
    });
    for (const tx of txs) {
      const txDate = tx.type === 'SALE' ? (tx.processedAt || share.purchaseDate) : share.purchaseDate;
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { createdAt: txDate },
      });
      txFixed++;
    }
  }

  console.log(`Shares createdAt fixed: ${sharesFixed}`);
  console.log(`Transactions createdAt fixed: ${txFixed}`);
  console.log('\nDone!');
}

main()
  .catch((e) => {
    console.error('Fix failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
