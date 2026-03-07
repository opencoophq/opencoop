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

  // Create default roles for the coop
  const defaultRoles = [
    { name: 'Admin', permissions: { canManageShareholders: true, canManageTransactions: true, canManageShareClasses: true, canManageProjects: true, canManageDividends: true, canManageSettings: true, canManageAdmins: true, canViewPII: true, canViewReports: true, canViewShareholderRegister: true } },
    { name: 'Viewer', permissions: { canManageShareholders: false, canManageTransactions: false, canManageShareClasses: false, canManageProjects: false, canManageDividends: false, canManageSettings: false, canManageAdmins: false, canViewPII: true, canViewReports: true, canViewShareholderRegister: true } },
    { name: 'GDPR Viewer', permissions: { canManageShareholders: false, canManageTransactions: false, canManageShareClasses: false, canManageProjects: false, canManageDividends: false, canManageSettings: false, canManageAdmins: false, canViewPII: false, canViewReports: true, canViewShareholderRegister: false } },
    { name: 'GDPR Admin', permissions: { canManageShareholders: false, canManageTransactions: false, canManageShareClasses: true, canManageProjects: true, canManageDividends: true, canManageSettings: true, canManageAdmins: false, canViewPII: false, canViewReports: true, canViewShareholderRegister: false } },
  ];

  for (const role of defaultRoles) {
    await prisma.coopRole.upsert({
      where: { coopId_name: { coopId: coop.id, name: role.name } },
      update: { permissions: role.permissions },
      create: { coopId: coop.id, name: role.name, permissions: role.permissions, isDefault: true },
    });
  }
  const adminRole = await prisma.coopRole.findUniqueOrThrow({
    where: { coopId_name: { coopId: coop.id, name: 'Admin' } },
  });
  console.log('  Default roles created');

  // Link both admin users to the coop
  for (const user of [adminUser, coopAdminUser]) {
    await prisma.coopAdmin.upsert({
      where: { userId_coopId: { userId: user.id, coopId: coop.id } },
      update: { roleId: adminRole.id },
      create: { userId: user.id, coopId: coop.id, roleId: adminRole.id },
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
  // 6. REGISTRATIONS & PAYMENTS
  // ---------------------------------------------------------------------------

  // Check if we already seeded registrations (idempotency)
  const existingRegCount = await prisma.registration.count({ where: { coopId: coop.id } });
  if (existingRegCount > 0) {
    console.log('\n  Registrations already exist — skipping');
  } else {
    console.log('\n  Creating registrations & payments...');

    const ogmPrefix = coop.ogmPrefix;

    const buys = [
      { shareholder: janShareholder, shareClass: shareClassA, project: solarProject, qty: 4, date: new Date('2024-04-01'), completed: true },
      { shareholder: janShareholder, shareClass: shareClassB, project: windProject, qty: 2, date: new Date('2024-07-15'), completed: true },
      { shareholder: elsShareholder, shareClass: shareClassA, project: solarProject, qty: 2, date: new Date('2024-05-10'), completed: true },
      { shareholder: bakkerijShareholder, shareClass: shareClassA, project: solarProject, qty: 10, date: new Date('2024-04-20'), completed: true },
      { shareholder: bakkerijShareholder, shareClass: shareClassB, project: windProject, qty: 4, date: new Date('2024-08-01'), completed: true },
      { shareholder: marcShareholder, shareClass: shareClassA, project: solarProject, qty: 2, date: new Date('2024-06-05'), completed: true },
      { shareholder: sophieShareholder, shareClass: shareClassA, project: solarProject, qty: 1, date: new Date('2025-01-20'), completed: false },
      { shareholder: lucasShareholder, shareClass: shareClassA, project: solarProject, qty: 1, date: new Date('2024-09-10'), completed: true },
    ];

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < buys.length; i++) {
        const b = buys[i];
        const pricePerShare = Number(b.shareClass.pricePerShare);
        const totalAmount = b.qty * pricePerShare;

        const registration = await tx.registration.create({
          data: {
            coopId: coop!.id,
            shareholderId: b.shareholder.id,
            shareClassId: b.shareClass.id,
            projectId: b.project.id,
            type: 'BUY',
            status: b.completed ? 'COMPLETED' : 'PENDING',
            quantity: b.qty,
            pricePerShare,
            totalAmount,
            registerDate: b.date,
            ogmCode: generateOgmCode(ogmPrefix, i + 1),
            certificateNumber: b.completed
              ? `${coop!.slug.toUpperCase()}-${b.shareClass.code}-${String(i + 1).padStart(4, '0')}`
              : null,
            processedByUserId: b.completed ? coopAdminUser.id : null,
            processedAt: b.completed ? b.date : null,
            createdAt: b.date,
          },
        });

        // Create payment for completed registrations
        if (b.completed) {
          await tx.payment.create({
            data: {
              registrationId: registration.id,
              coopId: coop!.id,
              amount: totalAmount,
              bankDate: b.date,
              matchedAt: b.date,
              createdAt: b.date,
            },
          });
        }
      }
    });

    console.log(`  Created ${buys.length} registrations & payments`);
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

    const activeRegistrations = await prisma.registration.findMany({
      where: {
        coopId: coop.id,
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
        shareholderId: { in: activeShareholders.map((s) => s.id) },
      },
      include: { shareClass: true, payments: true },
    });

    // Group registrations by shareholder
    const regsByShareholder = new Map<string, typeof activeRegistrations>();
    for (const reg of activeRegistrations) {
      const existing = regsByShareholder.get(reg.shareholderId) || [];
      existing.push(reg);
      regsByShareholder.set(reg.shareholderId, existing);
    }

    for (const shareholder of activeShareholders) {
      const regs = regsByShareholder.get(shareholder.id) || [];
      if (regs.length === 0) continue;

      let grossAmount = new Prisma.Decimal(0);
      const breakdown: { shareClass: string; shares: number; value: string; gross: string }[] = [];

      for (const reg of regs) {
        const totalPaid = reg.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const pricePerShare = Number(reg.pricePerShare);
        const sharesOwned = Math.min(Math.floor(totalPaid / pricePerShare), reg.quantity);
        if (sharesOwned === 0) continue;

        const rate = reg.shareClass.dividendRateOverride
          ? Number(reg.shareClass.dividendRateOverride)
          : dividendRate;
        const value = sharesOwned * pricePerShare;
        const gross = value * rate;
        grossAmount = grossAmount.add(new Prisma.Decimal(gross));
        breakdown.push({
          shareClass: reg.shareClass.code,
          shares: sharesOwned,
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
