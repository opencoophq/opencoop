/**
 * Bronsgroen data migration script.
 *
 * Imports shareholders and share register from CSV exports into the existing
 * Bronsgroen coop in production.
 *
 * Input files (expected in ~/Downloads/):
 *   - Coöperanten-2.csv          — 751 shareholders
 *   - Aandelenregister-3.csv     — 994 share register entries
 *
 * Usage (via SSH tunnel to prod postgres):
 *   1. Get the container IP:
 *      ssh wouter@fsn1.tailde0fcd.ts.net "docker inspect prod-postgres-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"
 *   2. Open SSH tunnel:
 *      ssh -f -N -L 5433:<container-ip>:5432 wouter@fsn1.tailde0fcd.ts.net
 *   3. Run the migration:
 *      DATABASE_URL="postgresql://opencoop:<password>@localhost:5433/opencoop" npx tsx packages/database/prisma/migrate-bronsgroen.ts
 *   4. Kill the tunnel:
 *      pkill -f "ssh -f -N -L 5433"
 *
 * Output files (in cwd):
 *   - bronsgroen-duplicate-emails.json    — shareholders whose email was modified with +N suffix
 *   - bronsgroen-exits.json               — shareholders who exited (sold all/some shares)
 *   - bronsgroen-savings.json             — shareholders on savings plans (partial payment)
 *   - bronsgroen-no-email.json            — shareholders without an email address
 *   - bronsgroen-no-shares.json           — shareholders with no register entries (0 shares)
 *   - bronsgroen-skipped-rows.json        — register rows that couldn't be imported
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();
const COOP_SLUG = 'bronsgroen';
const DOWNLOADS = path.join(process.env.HOME || '~', 'Downloads');

// Wind projects — all others are SOLAR
const WIND_PROJECTS = new Set([
  'Onze Energie: Northwind',
  'Bilzen: Kieleberg',
  'Genk-Zuid',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEuro(s: string): number | null {
  if (!s || !s.trim()) return null;
  // "€ 2.000,00" → 2000.00
  return parseFloat(
    s.replace('€', '').replace(/\./g, '').replace(',', '.').trim(),
  );
}

function parseDate(s: string): Date | null {
  if (!s || !s.trim()) return null;
  // "11-12-2025" (DD-MM-YYYY) or "1-4-2012"
  const parts = s.trim().split('-');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  return new Date(year, month - 1, day);
}

function readCsv(filename: string): Record<string, string>[] {
  const content = fs.readFileSync(path.join(DOWNLOADS, filename), 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
}

// OGM generation (same as @opencoop/shared)
function generateOgmCode(prefix: string, sequence: number): string {
  const base = prefix + sequence.toString().padStart(7, '0');
  const num = BigInt(base);
  let checkDigit = Number(num % BigInt(97));
  if (checkDigit === 0) checkDigit = 97;
  const full = base + checkDigit.toString().padStart(2, '0');
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Bronsgroen Migration ===\n');

  // 1. Verify coop exists
  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) {
    console.error(`ERROR: Coop "${COOP_SLUG}" not found!`);
    process.exit(1);
  }
  console.log(`Coop: ${coop.name} (${coop.id})`);

  // Check for existing data
  const existingShareholders = await prisma.shareholder.count({
    where: { coopId: coop.id },
  });
  if (existingShareholders > 0) {
    console.error(
      `ERROR: Coop already has ${existingShareholders} shareholders. Aborting to prevent duplicates.`,
    );
    process.exit(1);
  }

  // 2. Read CSVs
  const shareholderRows = readCsv('Coöperanten-2.csv');
  const registerRows = readCsv('Aandelenregister-3.csv');
  console.log(
    `\nCSV loaded: ${shareholderRows.length} shareholders, ${registerRows.length} register entries`,
  );

  // 3. Create share class
  const shareClass = await prisma.shareClass.create({
    data: {
      coopId: coop.id,
      name: 'Aandeel A',
      code: 'A',
      pricePerShare: 125.0,
      minShares: 1,
      maxShares: null,
      hasVotingRights: true,
      isActive: true,
    },
  });
  console.log(`\nShare class created: ${shareClass.name} @ €125`);

  // 4. Create projects
  const projectNames = [
    ...new Set(
      registerRows
        .map((r) => r['Project']?.trim())
        .filter((p) => p && p.length > 0),
    ),
  ];

  const projectMap: Record<string, string> = {}; // name → id
  for (const name of projectNames) {
    const project = await prisma.project.create({
      data: {
        coopId: coop.id,
        name,
        type: WIND_PROJECTS.has(name) ? 'WIND' : 'SOLAR',
        isActive: true,
      },
    });
    projectMap[name] = project.id;
  }
  console.log(`Projects created: ${projectNames.length}`);
  for (const name of projectNames) {
    const type = WIND_PROJECTS.has(name) ? 'WIND' : 'SOLAR';
    console.log(`  - ${name} (${type})`);
  }

  // 5. Create shareholders (handle duplicate emails)
  const duplicateEmailLog: {
    csvId: string;
    firstName: string;
    lastName: string;
    originalEmail: string;
    modifiedEmail: string;
  }[] = [];

  const noEmailLog: {
    csvId: string;
    firstName: string;
    lastName: string;
    city: string;
  }[] = [];

  const noSharesLog: {
    csvId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    city: string;
  }[] = [];

  const exitsLog: {
    csvId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    totalShares: number;
    exitedShares: number;
    fullyExited: boolean;
    exitDetails: { registerRowId: string; quantity: number; exitAmount: string; exitDate: string; reason: string }[];
  }[] = [];

  const savingsLog: {
    csvId: string;
    firstName: string;
    lastName: string;
    email: string | null;
    registerRowId: string;
    project: string;
    quantity: number;
    targetAmount: string;
    paidAmount: string;
    detail: string;
  }[] = [];

  const skippedRowsLog: {
    registerRowId: string;
    reason: string;
    rawData: Record<string, string>;
  }[] = [];

  // Track emails we've already used for this coop
  const usedEmails = new Set<string>();
  // Map CSV shareholder ID → Prisma shareholder ID
  const shareholderMap: Record<string, string> = {};

  // Collect register rows per shareholder to determine exit status
  const registerByShareholder: Record<string, typeof registerRows> = {};
  for (const r of registerRows) {
    const sid = r['Coöperant naam: Id']?.trim();
    if (!sid) continue;
    if (!registerByShareholder[sid]) registerByShareholder[sid] = [];
    registerByShareholder[sid].push(r);
  }

  // Determine which shareholders are fully exited + build exits log
  const fullyExitedIds = new Set<string>();
  const shareholderIdToRow: Record<string, Record<string, string>> = {};
  for (const row of shareholderRows) {
    const csvId = row['Id']?.trim();
    if (csvId) shareholderIdToRow[csvId] = row;
  }

  for (const [sid, rows] of Object.entries(registerByShareholder)) {
    const totalShares = rows.reduce(
      (sum, r) => sum + (parseInt(r['Aantal aandelen']) || 0),
      0,
    );
    const exitRows = rows.filter((r) => r['Uittreding']?.trim());
    const exitedShares = exitRows.reduce(
      (sum, r) => sum + (parseInt(r['Aantal aandelen']) || 0),
      0,
    );
    if (exitedShares >= totalShares && totalShares > 0) {
      fullyExitedIds.add(sid);
    }

    // Log exits
    if (exitRows.length > 0) {
      const shRow = shareholderIdToRow[sid];
      exitsLog.push({
        csvId: sid,
        firstName: shRow?.['Voornaam']?.trim() || '',
        lastName: shRow?.['Naam']?.trim() || '',
        email: shRow?.['Email']?.trim()?.toLowerCase() || null,
        totalShares,
        exitedShares,
        fullyExited: exitedShares >= totalShares,
        exitDetails: exitRows.map((r) => ({
          registerRowId: r['Id'],
          quantity: parseInt(r['Aantal aandelen']) || 0,
          exitAmount: r['Uittreding']?.trim() || '',
          exitDate: r['Datum Uittreding']?.trim() || '',
          reason: r['Aanvraag tot uittreden?']?.trim() || '',
        })),
      });
    }

    // Log savings
    for (const r of rows) {
      if (r['Spaarformule']?.trim() === 'Waar' || (!r['Datum Storting']?.trim() && r['Bedrag']?.trim())) {
        const shRow = shareholderIdToRow[sid];
        savingsLog.push({
          csvId: sid,
          firstName: shRow?.['Voornaam']?.trim() || '',
          lastName: shRow?.['Naam']?.trim() || '',
          email: shRow?.['Email']?.trim()?.toLowerCase() || null,
          registerRowId: r['Id'],
          project: r['Project']?.trim() || '',
          quantity: parseInt(r['Aantal aandelen']) || 0,
          targetAmount: r['Bedrag']?.trim() || '',
          paidAmount: r['Gestort']?.trim() || '',
          detail: r['Detail']?.trim() || '',
        });
      }
    }
  }

  let shareholderCount = 0;
  for (const row of shareholderRows) {
    const csvId = row['Id']?.trim();
    if (!csvId) continue;

    let email = row['Email']?.trim()?.toLowerCase() || null;

    // Track shareholders with no email
    if (!email) {
      noEmailLog.push({
        csvId,
        firstName: row['Voornaam']?.trim() || '',
        lastName: row['Naam']?.trim() || '',
        city: row['Gemeente']?.trim() || '',
      });
    }

    // Track shareholders with no register entries
    if (!registerByShareholder[csvId]) {
      noSharesLog.push({
        csvId,
        firstName: row['Voornaam']?.trim() || '',
        lastName: row['Naam']?.trim() || '',
        email,
        city: row['Gemeente']?.trim() || '',
      });
    }

    // Handle duplicate emails
    if (email && usedEmails.has(email)) {
      const [local, domain] = email.split('@');
      let suffix = 2;
      let modified = `${local}+${suffix}@${domain}`;
      while (usedEmails.has(modified)) {
        suffix++;
        modified = `${local}+${suffix}@${domain}`;
      }
      duplicateEmailLog.push({
        csvId,
        firstName: row['Voornaam']?.trim() || '',
        lastName: row['Naam']?.trim() || '',
        originalEmail: email,
        modifiedEmail: modified,
      });
      email = modified;
    }

    if (email) usedEmails.add(email);

    const street = row['Straat']?.trim() || null;
    const number = row['Huisnummer']?.trim() || null;
    const postalCode = row['Postcode']?.trim() || null;
    const city = row['Gemeente']?.trim() || null;

    const address =
      street || number || postalCode || city
        ? { street, number, postalCode, city, country: 'BE' }
        : null;

    const status = fullyExitedIds.has(csvId) ? 'INACTIVE' : 'ACTIVE';

    // Find bank IBAN from register rows (first non-empty one)
    const regRows = registerByShareholder[csvId] || [];
    const bankIban =
      regRows
        .map((r) => r['Rekeningnummer']?.trim())
        .find((iban) => iban && iban.length > 0)
        ?.replace(/\s+/g, '') || null;

    const shareholder = await prisma.shareholder.create({
      data: {
        coopId: coop.id,
        type: 'INDIVIDUAL',
        status,
        firstName: row['Voornaam']?.trim() || null,
        lastName: row['Naam']?.trim() || null,
        email,
        phone: row['Telefoonnummer']?.trim() || null,
        address: address as any,
        bankIban,
      },
    });

    shareholderMap[csvId] = shareholder.id;
    shareholderCount++;
  }

  console.log(`\nShareholders created: ${shareholderCount}`);
  console.log(
    `  - Active: ${shareholderCount - fullyExitedIds.size}`,
  );
  console.log(`  - Inactive (fully exited): ${fullyExitedIds.size}`);

  // Save all special case logs
  const outputDir = process.cwd();
  const writeLog = (name: string, data: unknown[]) => {
    const logPath = path.join(outputDir, `bronsgroen-${name}.json`);
    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
    console.log(`  ${name}: ${data.length} entries → ${logPath}`);
  };

  console.log('\nSpecial case reports:');
  writeLog('duplicate-emails', duplicateEmailLog);
  writeLog('exits', exitsLog);
  writeLog('savings', savingsLog);
  writeLog('no-email', noEmailLog);
  writeLog('no-shares', noSharesLog);

  // 6. Create shares and transactions
  let shareCount = 0;
  let txPurchaseCount = 0;
  let txSaleCount = 0;
  let skippedCount = 0;
  let ogmSequence = 1;

  for (const row of registerRows) {
    const csvShId = row['Coöperant naam: Id']?.trim();
    if (!csvShId || !shareholderMap[csvShId]) {
      skippedCount++;
      skippedRowsLog.push({
        registerRowId: row['Id'],
        reason: !csvShId ? 'Missing shareholder ID' : `Shareholder ID ${csvShId} not found in shareholder CSV`,
        rawData: row,
      });
      continue;
    }

    const shareholderId = shareholderMap[csvShId];
    const quantity = parseInt(row['Aantal aandelen']) || 0;
    if (quantity <= 0) {
      skippedCount++;
      skippedRowsLog.push({
        registerRowId: row['Id'],
        reason: `Invalid quantity: ${row['Aantal aandelen']}`,
        rawData: row,
      });
      continue;
    }

    const totalAmount = parseEuro(row['Bedrag']) || quantity * 125;
    const registrationDate = parseDate(row['Datum registratie']);
    const paymentDate = parseDate(row['Datum Storting']);
    const projectName = row['Project']?.trim() || null;
    const projectId = projectName ? projectMap[projectName] || null : null;
    const isSavings = row['Spaarformule']?.trim() === 'Waar';
    const hasExit = !!(row['Uittreding']?.trim());
    const exitDate = parseDate(row['Datum Uittreding']);

    // Determine share status
    let shareStatus: 'ACTIVE' | 'AWAITING_PAYMENT' | 'SOLD';
    if (hasExit) {
      shareStatus = 'SOLD';
    } else if (isSavings || !paymentDate) {
      shareStatus = 'AWAITING_PAYMENT';
    } else {
      shareStatus = 'ACTIVE';
    }

    // Create share
    const share = await prisma.share.create({
      data: {
        coopId: coop.id,
        shareholderId,
        shareClassId: shareClass.id,
        projectId,
        quantity,
        purchasePricePerShare: 125.0,
        purchaseDate: registrationDate || new Date(),
        paymentDate: paymentDate || null,
        status: shareStatus,
      },
    });
    shareCount++;

    // Create PURCHASE transaction
    const purchaseTxStatus =
      shareStatus === 'AWAITING_PAYMENT' ? 'AWAITING_PAYMENT' : 'COMPLETED';

    const purchaseTx = await prisma.transaction.create({
      data: {
        coopId: coop.id,
        type: 'PURCHASE',
        status: purchaseTxStatus,
        shareholderId,
        shareId: share.id,
        quantity,
        pricePerShare: 125.0,
        totalAmount,
        processedAt:
          purchaseTxStatus === 'COMPLETED'
            ? (paymentDate || registrationDate || new Date())
            : null,
      },
    });
    txPurchaseCount++;

    // Create Payment for completed purchases
    if (purchaseTxStatus === 'COMPLETED') {
      const ogm = generateOgmCode(coop.ogmPrefix, ogmSequence++);
      await prisma.payment.create({
        data: {
          coopId: coop.id,
          transactionId: purchaseTx.id,
          method: 'BANK_TRANSFER',
          status: 'CONFIRMED',
          amount: totalAmount,
          ogmCode: ogm,
        },
      });
    }

    // Create SALE transaction for exits
    if (hasExit && exitDate) {
      const exitAmount = parseEuro(row['Uittreding']) || totalAmount;

      const saleTx = await prisma.transaction.create({
        data: {
          coopId: coop.id,
          type: 'SALE',
          status: 'COMPLETED',
          shareholderId,
          shareId: share.id,
          quantity,
          pricePerShare: 125.0,
          totalAmount: exitAmount,
          processedAt: exitDate,
        },
      });
      txSaleCount++;

      // Payment for the sale
      const ogm = generateOgmCode(coop.ogmPrefix, ogmSequence++);
      await prisma.payment.create({
        data: {
          coopId: coop.id,
          transactionId: saleTx.id,
          method: 'BANK_TRANSFER',
          status: 'CONFIRMED',
          amount: exitAmount,
          ogmCode: ogm,
        },
      });
    }
  }

  console.log(`\nShares created: ${shareCount}`);
  console.log(`Purchase transactions: ${txPurchaseCount}`);
  console.log(`Sale transactions: ${txSaleCount}`);
  if (skippedCount > 0) {
    console.log(`Skipped register rows: ${skippedCount}`);
    writeLog('skipped-rows', skippedRowsLog);
  }

  // Summary
  console.log('\n=== Migration Complete ===');
  console.log(`  Coop: ${coop.name} (${coop.slug})`);
  console.log(`  Share class: 1 (Aandeel A @ €125)`);
  console.log(`  Projects: ${projectNames.length}`);
  console.log(`  Shareholders: ${shareholderCount} (${shareholderCount - fullyExitedIds.size} active, ${fullyExitedIds.size} inactive)`);
  console.log(`  Shares: ${shareCount}`);
  console.log(`  Transactions: ${txPurchaseCount + txSaleCount} (${txPurchaseCount} purchases, ${txSaleCount} sales)`);
  console.log(`  Duplicate emails: ${duplicateEmailLog.length}`);
  console.log(`  Exits: ${exitsLog.length}`);
  console.log(`  Savings/partial: ${savingsLog.length}`);
  console.log(`  No email: ${noEmailLog.length}`);
  console.log(`  No shares: ${noSharesLog.length}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
