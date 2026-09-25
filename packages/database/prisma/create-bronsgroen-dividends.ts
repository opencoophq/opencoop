/**
 * Create historical dividend periods for Bronsgroen (2012 onwards, 1% rate).
 *
 * Skips years that already have a dividend period.
 * After creating, calculates payouts for each period.
 *
 * Usage:
 *   1. Open SSH tunnel to prod DB:
 *      ssh -f -N -L 5433:<container-ip>:5432 wouter@fsn1.tailde0fcd.ts.net
 *   2. Run:
 *      DATABASE_URL="postgresql://opencoop:<password>@localhost:5433/opencoop" npx tsx packages/database/prisma/create-bronsgroen-dividends.ts
 *   3. Kill the tunnel:
 *      pkill -f "ssh -f -N -L 5433"
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { computeVestedShares } from '../../shared/src/utils';

const prisma = new PrismaClient();
const COOP_SLUG = 'bronsgroen';
const DIVIDEND_RATE = 0.01; // 1%
const WITHHOLDING_TAX_RATE = 0.30; // 30% Belgian withholding tax
const START_YEAR = 2012;

async function main() {
  console.log('=== Bronsgroen Dividend Periods ===\n');

  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) {
    console.error('Coop not found');
    process.exit(1);
  }
  console.log(`Coop: ${coop.name} (${coop.id})\n`);

  // Find existing dividend periods
  const existing = await prisma.dividendPeriod.findMany({
    where: { coopId: coop.id },
    orderBy: { year: 'asc' },
  });
  const existingYears = new Set(existing.map((p) => p.year));
  console.log(`Existing periods: ${existing.map((p) => p.year).join(', ') || 'none'}`);

  // Determine end year: one before the earliest existing, or last full year
  const currentYear = new Date().getFullYear();
  const lastFullYear = currentYear - 1; // 2025
  const endYear = existingYears.size > 0
    ? Math.min(Math.min(...existingYears) - 1, lastFullYear)
    : lastFullYear;

  if (endYear < START_YEAR) {
    console.log(`\nNothing to create — periods already exist from ${Math.min(...existingYears)}`);
    return;
  }

  console.log(`\nCreating periods for ${START_YEAR}–${endYear} at ${DIVIDEND_RATE * 100}%\n`);

  for (let year = START_YEAR; year <= endYear; year++) {
    if (existingYears.has(year)) {
      console.log(`  ${year}: skipped (already exists)`);
      continue;
    }

    const exDividendDate = new Date(year, 11, 31); // Dec 31 of that year

    // Create the period
    const period = await prisma.dividendPeriod.create({
      data: {
        coopId: coop.id,
        name: `Boekjaar ${year}`,
        year,
        dividendRate: new Prisma.Decimal(DIVIDEND_RATE),
        withholdingTaxRate: new Prisma.Decimal(WITHHOLDING_TAX_RATE),
        exDividendDate,
        status: 'DRAFT',
      },
    });

    // Calculate payouts
    const payoutCount = await calculatePayouts(period.id, coop.id, exDividendDate);
    console.log(`  ${year}: created + calculated (${payoutCount} payouts)`);
  }

  console.log('\nDone.');
}

async function calculatePayouts(
  periodId: string,
  coopId: string,
  exDividendDate: Date,
): Promise<number> {
  // Find eligible BUY registrations with payments before ex-dividend date
  const registrations = await prisma.registration.findMany({
    where: {
      coopId,
      type: 'BUY',
      status: { in: ['ACTIVE', 'COMPLETED'] },
      payments: {
        some: {
          bankDate: { lt: exDividendDate },
        },
      },
    },
    include: {
      shareholder: true,
      shareClass: true,
      payments: {
        where: { bankDate: { lt: exDividendDate } },
        orderBy: { bankDate: 'asc' },
      },
    },
  });

  // Group by shareholder
  const byHolder = new Map<string, typeof registrations>();
  for (const reg of registrations) {
    const list = byHolder.get(reg.shareholderId) || [];
    list.push(reg);
    byHolder.set(reg.shareholderId, list);
  }

  const payouts: {
    dividendPeriodId: string;
    shareholderId: string;
    grossAmount: Prisma.Decimal;
    withholdingTax: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    calculationDetails: unknown;
  }[] = [];

  for (const [shareholderId, regs] of byHolder) {
    const details: {
      shareClassId: string;
      shareClassName: string;
      quantity: number;
      pricePerShare: number;
      totalValue: number;
      dividendRate: number;
      dividendAmount: number;
    }[] = [];

    for (const reg of regs) {
      const pricePerShare = Number(reg.pricePerShare);
      const totalPaid = reg.payments.reduce((s, p) => s + Number(p.amount), 0);
      const vestedShares = computeVestedShares(totalPaid, pricePerShare, reg.quantity);

      if (vestedShares <= 0) continue;

      // Use share class override if set, else period rate
      const rate = reg.shareClass.dividendRateOverride
        ? Number(reg.shareClass.dividendRateOverride)
        : DIVIDEND_RATE;

      const shareValue = vestedShares * pricePerShare;
      const dividendAmount = Math.round(shareValue * rate * 100) / 100;

      details.push({
        shareClassId: reg.shareClassId,
        shareClassName: reg.shareClass.name,
        quantity: vestedShares,
        pricePerShare,
        totalValue: shareValue,
        dividendRate: rate,
        dividendAmount,
      });
    }

    if (details.length === 0) continue;

    const grossAmount = details.reduce((s, d) => s + d.dividendAmount, 0);
    const tax = Math.round(grossAmount * WITHHOLDING_TAX_RATE * 100) / 100;
    const net = Math.round((grossAmount - tax) * 100) / 100;

    payouts.push({
      dividendPeriodId: periodId,
      shareholderId,
      grossAmount: new Prisma.Decimal(grossAmount.toFixed(2)),
      withholdingTax: new Prisma.Decimal(tax.toFixed(2)),
      netAmount: new Prisma.Decimal(net.toFixed(2)),
      calculationDetails: details,
    });
  }

  // Bulk create payouts
  if (payouts.length > 0) {
    await prisma.dividendPayout.createMany({ data: payouts as any });
    // Mark as CALCULATED
    await prisma.dividendPeriod.update({
      where: { id: periodId },
      data: { status: 'CALCULATED' },
    });
  }

  return payouts.length;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
