import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Inline OGM generation (same logic as @opencoop/shared)
function generateOgmCode(prefix: string, sequence: number): string {
  const base = prefix + sequence.toString().padStart(7, '0');
  const num = BigInt(base);
  let checkDigit = Number(num % BigInt(97));
  if (checkDigit === 0) checkDigit = 97;
  const full = base + checkDigit.toString().padStart(2, '0');
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}

async function main() {
  console.log('Seeding database...\n');

  const passwordHash = await bcrypt.hash('admin123', 12);
  const demoPasswordHash = await bcrypt.hash('demo1234', 12);

  // ---------------------------------------------------------------------------
  // 1. USERS
  // ---------------------------------------------------------------------------

  const adminUser = await prisma.user.upsert({
    where: { email: 'wouter.hermans@opencoop.be' },
    update: {},
    create: {
      email: 'wouter.hermans@opencoop.be',
      name: 'Wouter Hermans',
      passwordHash,
      role: 'SYSTEM_ADMIN',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
    },
  });
  console.log(`  User: ${adminUser.email} (SYSTEM_ADMIN)`);

  const coopAdminUser = await prisma.user.upsert({
    where: { email: 'admin@zonnecooperatie.be' },
    update: {},
    create: {
      email: 'admin@zonnecooperatie.be',
      name: 'Demo Admin',
      passwordHash: demoPasswordHash,
      role: 'COOP_ADMIN',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
    },
  });
  console.log(`  User: ${coopAdminUser.email} (COOP_ADMIN)`);

  const janUser = await prisma.user.upsert({
    where: { email: 'jan.peeters@email.be' },
    update: {},
    create: {
      email: 'jan.peeters@email.be',
      name: 'Jan Peeters',
      passwordHash: demoPasswordHash,
      role: 'SHAREHOLDER',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
    },
  });
  console.log(`  User: ${janUser.email} (SHAREHOLDER)`);

  const elsUser = await prisma.user.upsert({
    where: { email: 'els.devos@email.be' },
    update: {},
    create: {
      email: 'els.devos@email.be',
      name: 'Els De Vos',
      passwordHash: demoPasswordHash,
      role: 'SHAREHOLDER',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
    },
  });
  console.log(`  User: ${elsUser.email} (SHAREHOLDER)`);

  // ---------------------------------------------------------------------------
  // 2. COOP
  // ---------------------------------------------------------------------------

  // Clean up old slug if it exists
  const oldCoop = await prisma.coop.findFirst({ where: { slug: 'demo-coop' } });
  if (oldCoop) {
    await prisma.coop.update({ where: { id: oldCoop.id }, data: { slug: 'demo' } });
  }

  let coop = await prisma.coop.findFirst({ where: { slug: 'demo' } });
  if (!coop) {
    const lastCoop = await prisma.coop.findFirst({ orderBy: { ogmPrefix: 'desc' } });
    const nextPrefix = lastCoop
      ? String(parseInt(lastCoop.ogmPrefix, 10) + 1).padStart(3, '0')
      : '001';

    coop = await prisma.coop.create({
      data: {
        name: 'Zonnecoöperatie Vlaanderen',
        slug: 'demo',
        ogmPrefix: nextPrefix,
        bankIban: 'BE68539007547034',
        bankBic: 'BMPBBEBB',
        bankName: 'Belfius',
        requiresApproval: false,
        active: true,
        // Demo coop should not send emails
        emailEnabled: false,
        emailProvider: null,
      },
    });
  }
  console.log(`\n  Coop: ${coop.name} (slug: ${coop.slug})`);

  // Link both admin users to the coop
  for (const user of [adminUser, coopAdminUser]) {
    await prisma.coopAdmin.upsert({
      where: { userId_coopId: { userId: user.id, coopId: coop.id } },
      update: {},
      create: { userId: user.id, coopId: coop.id },
    });
  }
  console.log('  Admins linked to coop');

  // ---------------------------------------------------------------------------
  // 3. PROJECTS
  // ---------------------------------------------------------------------------

  const solarProject = await prisma.project.upsert({
    where: { coopId_name: { coopId: coop.id, name: 'Zonnepark Gent-Zuid' } },
    update: {},
    create: {
      coopId: coop.id,
      name: 'Zonnepark Gent-Zuid',
      description: 'Zonne-installatie op industrieterrein Gent-Zuid met 1.800 panelen.',
      type: 'SOLAR',
      capacityKw: 500,
      estimatedAnnualMwh: 450,
      startDate: new Date('2024-03-15'),
      isActive: true,
    },
  });
  console.log(`  Project: ${solarProject.name} (SOLAR)`);

  const windProject = await prisma.project.upsert({
    where: { coopId_name: { coopId: coop.id, name: 'Windturbine Oostende' } },
    update: {},
    create: {
      coopId: coop.id,
      name: 'Windturbine Oostende',
      description: 'Windturbine aan de haven van Oostende, operationeel sinds 2024.',
      type: 'WIND',
      capacityKw: 2000,
      estimatedAnnualMwh: 4500,
      startDate: new Date('2024-06-01'),
      isActive: true,
    },
  });
  console.log(`  Project: ${windProject.name} (WIND)`);

  // ---------------------------------------------------------------------------
  // 4. SHARE CLASSES
  // ---------------------------------------------------------------------------

  const shareClassA = await prisma.shareClass.upsert({
    where: { coopId_code: { coopId: coop.id, code: 'A' } },
    update: {},
    create: {
      coopId: coop.id,
      name: 'Aandeel A',
      code: 'A',
      pricePerShare: 250,
      minShares: 1,
      maxShares: 100,
      hasVotingRights: true,
      isActive: true,
    },
  });
  console.log(`  Share class: ${shareClassA.name} (€250)`);

  const shareClassB = await prisma.shareClass.upsert({
    where: { coopId_code: { coopId: coop.id, code: 'B' } },
    update: {},
    create: {
      coopId: coop.id,
      name: 'Aandeel B',
      code: 'B',
      pricePerShare: 500,
      minShares: 1,
      maxShares: 50,
      hasVotingRights: true,
      dividendRateOverride: 0.04,
      isActive: true,
    },
  });
  console.log(`  Share class: ${shareClassB.name} (€500, 4% dividend)`);

  // ---------------------------------------------------------------------------
  // 5. SHAREHOLDERS
  // ---------------------------------------------------------------------------

  const address = (city: string) => ({
    street: 'Kerkstraat',
    number: '12',
    postalCode: '9000',
    city,
    country: 'BE',
  });

  const janShareholder = await prisma.shareholder.upsert({
    where: { coopId_email: { coopId: coop.id, email: 'jan.peeters@email.be' } },
    update: {},
    create: {
      coopId: coop.id,
      userId: janUser.id,
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      firstName: 'Jan',
      lastName: 'Peeters',
      email: 'jan.peeters@email.be',
      phone: '+32 479 12 34 56',
      nationalId: '85031512345',
      birthDate: new Date('1985-03-15'),
      address: address('Gent'),
    },
  });

  const elsShareholder = await prisma.shareholder.upsert({
    where: { coopId_email: { coopId: coop.id, email: 'els.devos@email.be' } },
    update: {},
    create: {
      coopId: coop.id,
      userId: elsUser.id,
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      firstName: 'Els',
      lastName: 'De Vos',
      email: 'els.devos@email.be',
      phone: '+32 486 65 43 21',
      nationalId: '90060712345',
      birthDate: new Date('1990-06-07'),
      address: address('Antwerpen'),
    },
  });

  const bakkerijShareholder = await prisma.shareholder.upsert({
    where: { coopId_email: { coopId: coop.id, email: 'info@bakkerijjanssens.be' } },
    update: {},
    create: {
      coopId: coop.id,
      type: 'COMPANY',
      status: 'ACTIVE',
      companyName: 'Bakkerij Janssens BVBA',
      companyId: '0456789012',
      vatNumber: '0456789012',
      legalForm: 'BVBA',
      email: 'info@bakkerijjanssens.be',
      phone: '+32 9 234 56 78',
      address: { ...address('Brugge'), street: 'Markt', number: '45' },
    },
  });

  // Add beneficial owner for company shareholder
  const existingOwner = await prisma.beneficialOwner.findFirst({
    where: { shareholderId: bakkerijShareholder.id },
  });
  if (!existingOwner) {
    await prisma.beneficialOwner.create({
      data: {
        shareholderId: bakkerijShareholder.id,
        firstName: 'Peter',
        lastName: 'Janssens',
        nationalId: '75082012345',
        ownershipPercentage: 100,
      },
    });
  }

  const marcShareholder = await prisma.shareholder.upsert({
    where: { coopId_email: { coopId: coop.id, email: 'marc.willems@email.be' } },
    update: {},
    create: {
      coopId: coop.id,
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      firstName: 'Marc',
      lastName: 'Willems',
      email: 'marc.willems@email.be',
      phone: '+32 478 99 88 77',
      nationalId: '78112212345',
      birthDate: new Date('1978-11-22'),
      address: address('Leuven'),
    },
  });

  const sophieShareholder = await prisma.shareholder.upsert({
    where: { coopId_email: { coopId: coop.id, email: 'sophie.lambert@email.be' } },
    update: {},
    create: {
      coopId: coop.id,
      type: 'INDIVIDUAL',
      status: 'PENDING',
      firstName: 'Sophie',
      lastName: 'Lambert',
      email: 'sophie.lambert@email.be',
      phone: '+32 492 11 22 33',
      birthDate: new Date('1995-04-18'),
      address: address('Mechelen'),
    },
  });

  // Minor shareholder — no email (uses parent contact), registered by Jan
  let lucasShareholder = await prisma.shareholder.findFirst({
    where: {
      coopId: coop.id,
      firstName: 'Lucas',
      lastName: 'Peeters',
      type: 'MINOR',
    },
  });
  if (!lucasShareholder) {
    lucasShareholder = await prisma.shareholder.create({
      data: {
        coopId: coop.id,
        registeredByUserId: janUser.id,
        type: 'MINOR',
        status: 'ACTIVE',
        firstName: 'Lucas',
        lastName: 'Peeters',
        birthDate: new Date('2012-09-03'),
        address: address('Gent'),
      },
    });
  }

  console.log('\n  Shareholders:');
  console.log(`    ${janShareholder.firstName} ${janShareholder.lastName} (INDIVIDUAL)`);
  console.log(`    ${elsShareholder.firstName} ${elsShareholder.lastName} (INDIVIDUAL)`);
  console.log(`    ${bakkerijShareholder.companyName} (COMPANY)`);
  console.log(`    ${marcShareholder.firstName} ${marcShareholder.lastName} (INDIVIDUAL, no user)`);
  console.log(`    ${sophieShareholder.firstName} ${sophieShareholder.lastName} (PENDING)`);
  console.log(`    ${lucasShareholder.firstName} ${lucasShareholder.lastName} (MINOR)`);

  // ---------------------------------------------------------------------------
  // 6. SHARES, TRANSACTIONS & PAYMENTS
  // ---------------------------------------------------------------------------

  // Check if we already seeded transactions (idempotency)
  const existingTxCount = await prisma.transaction.count({ where: { coopId: coop.id } });
  if (existingTxCount > 0) {
    console.log('\n  Transactions already exist — skipping shares/transactions/payments');
  } else {
    console.log('\n  Creating shares, transactions & payments...');

    const ogmPrefix = coop.ogmPrefix;

    // Define all purchase records
    const purchases = [
      {
        shareholder: janShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 4,
        date: new Date('2024-04-01'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: janShareholder,
        shareClass: shareClassB,
        project: windProject,
        qty: 2,
        date: new Date('2024-07-15'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: elsShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 2,
        date: new Date('2024-05-10'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: bakkerijShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 10,
        date: new Date('2024-04-20'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: bakkerijShareholder,
        shareClass: shareClassB,
        project: windProject,
        qty: 4,
        date: new Date('2024-08-01'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: marcShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 2,
        date: new Date('2024-06-05'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
      {
        shareholder: sophieShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 1,
        date: new Date('2025-01-20'),
        status: 'PENDING' as const,
        paymentStatus: 'PENDING' as const,
      },
      {
        shareholder: lucasShareholder,
        shareClass: shareClassA,
        project: solarProject,
        qty: 1,
        date: new Date('2024-09-10'),
        status: 'COMPLETED' as const,
        paymentStatus: 'CONFIRMED' as const,
      },
    ];

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < purchases.length; i++) {
        const p = purchases[i];
        const pricePerShare = Number(p.shareClass.pricePerShare);
        const totalAmount = p.qty * pricePerShare;
        const isCompleted = p.status === 'COMPLETED';

        const share = await tx.share.create({
          data: {
            coopId: coop!.id,
            shareholderId: p.shareholder.id,
            shareClassId: p.shareClass.id,
            projectId: p.project.id,
            quantity: p.qty,
            purchasePricePerShare: pricePerShare,
            purchaseDate: p.date,
            status: isCompleted ? 'ACTIVE' : 'PENDING',
            certificateNumber: isCompleted
              ? `${coop!.slug.toUpperCase()}-${p.shareClass.code}-${String(i + 1).padStart(4, '0')}`
              : null,
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            coopId: coop!.id,
            type: 'PURCHASE',
            status: p.status,
            shareholderId: p.shareholder.id,
            shareId: share.id,
            quantity: p.qty,
            pricePerShare: pricePerShare,
            totalAmount: totalAmount,
            processedByUserId: isCompleted ? coopAdminUser.id : null,
            processedAt: isCompleted ? p.date : null,
            createdAt: p.date,
          },
        });

        await tx.payment.create({
          data: {
            coopId: coop!.id,
            transactionId: transaction.id,
            method: 'BANK_TRANSFER',
            status: p.paymentStatus,
            amount: totalAmount,
            currency: 'EUR',
            ogmCode: generateOgmCode(ogmPrefix, i + 1),
            createdAt: p.date,
          },
        });
      }
    });

    console.log(`  Created ${purchases.length} shares, transactions & payments`);
  }

  // ---------------------------------------------------------------------------
  // 7. DIVIDEND PERIOD & PAYOUTS
  // ---------------------------------------------------------------------------

  const existingDividend = await prisma.dividendPeriod.findUnique({
    where: { coopId_year: { coopId: coop.id, year: 2025 } },
  });

  if (existingDividend) {
    console.log('\n  Dividend period 2025 already exists — skipping');
  } else {
    console.log('\n  Creating dividend period 2025...');

    const dividendRate = 0.03; // 3%
    const withholdingTaxRate = 0.3; // 30%
    const bShareRate = 0.04; // 4% override for B-shares
    const paymentDate = new Date('2025-03-15');

    const period = await prisma.dividendPeriod.create({
      data: {
        coopId: coop.id,
        name: 'Boekjaar 2025',
        year: 2025,
        status: 'PAID',
        dividendRate: dividendRate,
        withholdingTaxRate: withholdingTaxRate,
        exDividendDate: new Date('2025-12-31'),
        paymentDate: paymentDate,
      },
    });

    // Calculate payouts for all ACTIVE shareholders with shares
    const activeShareholders = [
      janShareholder,
      elsShareholder,
      bakkerijShareholder,
      marcShareholder,
      lucasShareholder,
    ];

    const activeShares = await prisma.share.findMany({
      where: {
        coopId: coop.id,
        status: 'ACTIVE',
        shareholderId: { in: activeShareholders.map((s) => s.id) },
      },
      include: { shareClass: true },
    });

    // Group shares by shareholder
    const sharesByShareholder = new Map<string, typeof activeShares>();
    for (const share of activeShares) {
      const existing = sharesByShareholder.get(share.shareholderId) || [];
      existing.push(share);
      sharesByShareholder.set(share.shareholderId, existing);
    }

    for (const shareholder of activeShareholders) {
      const shares = sharesByShareholder.get(shareholder.id) || [];
      if (shares.length === 0) continue;

      let grossAmount = new Prisma.Decimal(0);
      const breakdown: { shareClass: string; shares: number; value: string; gross: string }[] = [];

      for (const share of shares) {
        const rate = share.shareClass.dividendRateOverride
          ? Number(share.shareClass.dividendRateOverride)
          : dividendRate;
        const value = share.quantity * Number(share.purchasePricePerShare);
        const gross = value * rate;
        grossAmount = grossAmount.add(new Prisma.Decimal(gross));
        breakdown.push({
          shareClass: share.shareClass.code,
          shares: share.quantity,
          value: value.toFixed(2),
          gross: gross.toFixed(2),
        });
      }

      const withholdingTax = grossAmount.mul(new Prisma.Decimal(withholdingTaxRate));
      const netAmount = grossAmount.sub(withholdingTax);

      await prisma.dividendPayout.create({
        data: {
          dividendPeriodId: period.id,
          shareholderId: shareholder.id,
          grossAmount: grossAmount,
          withholdingTax: withholdingTax,
          netAmount: netAmount,
          calculationDetails: breakdown,
          paidAt: paymentDate,
          paymentReference: `DIV-2025-${shareholder.lastName || shareholder.companyName}`,
        },
      });
    }

    console.log(`  Dividend period created with ${activeShareholders.length} payouts`);
  }

  console.log('\nSeed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
