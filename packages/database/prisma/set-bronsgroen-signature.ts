/**
 * One-time script: set certificateSignatureUrl for the Bronsgroen coop.
 * Run with: pnpm tsx packages/database/prisma/set-bronsgroen-signature.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.coop.updateMany({
    where: { slug: 'bronsgroen' },
    data: { certificateSignatureUrl: '/uploads/signatures/bronsgroen-signature.png' },
  });

  if (result.count === 0) {
    console.error('No coop found with slug "bronsgroen"');
    process.exit(1);
  }

  console.log(`Updated ${result.count} coop(s) with signature URL`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
