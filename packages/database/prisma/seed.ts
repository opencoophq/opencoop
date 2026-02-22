import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create system admin user
  const passwordHash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@opencoop.be' },
    update: {},
    create: {
      email: 'admin@opencoop.be',
      passwordHash,
      role: 'SYSTEM_ADMIN',
      preferredLanguage: 'nl',
      emailVerified: new Date(),
    },
  });
  console.log(`System admin created: ${admin.email}`);

  // Create demo coop (or use existing one)
  let coop = await prisma.coop.findFirst({ where: { slug: 'demo-coop' } });
  if (!coop) {
    // Find next available ogmPrefix
    const lastCoop = await prisma.coop.findFirst({ orderBy: { ogmPrefix: 'desc' } });
    const nextPrefix = lastCoop
      ? String(parseInt(lastCoop.ogmPrefix, 10) + 1).padStart(3, '0')
      : '001';

    coop = await prisma.coop.create({
      data: {
        name: 'Demo Cooperatie',
        slug: 'demo-coop',
        ogmPrefix: nextPrefix,
        bankIban: 'BE68539007547034',
        bankBic: 'BMPBBEBB',
        bankName: 'Belfius',
        requiresApproval: false,
      },
    });
  }
  console.log(`Demo coop created: ${coop.name}`);

  // Make admin a coop admin
  await prisma.coopAdmin.upsert({
    where: {
      userId_coopId: { userId: admin.id, coopId: coop.id },
    },
    update: {},
    create: {
      userId: admin.id,
      coopId: coop.id,
    },
  });
  console.log('Admin linked to demo coop');

  // Create sample share class
  const shareClass = await prisma.shareClass.upsert({
    where: {
      coopId_code: { coopId: coop.id, code: 'A' },
    },
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
  console.log(`Share class created: ${shareClass.name} (${shareClass.code})`);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
