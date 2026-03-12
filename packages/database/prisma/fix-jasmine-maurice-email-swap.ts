/**
 * Fix Jasmine Verriet / Maurice Kennes-Vanhove email swap and minor status.
 *
 * Problem: During migration, email differentiation assigned Maurice's real
 * email (kennes.maurice@skynet.be) to his daughter Jasmine, and gave Maurice
 * a modified version. Jasmine also wasn't set as MINOR type.
 *
 * Fix:
 *  1. Swap emails: Maurice gets his real email back, Jasmine gets null (standard for minors)
 *  2. Set Jasmine as type MINOR
 *  3. Set Jasmine's registeredByUserId to Maurice's userId
 *  4. Clear Jasmine's userId (minors don't have independent login)
 *
 * Usage:
 *   # Dry run (default):
 *   DATABASE_URL="postgresql://..." npx tsx fix-jasmine-maurice-email-swap.ts
 *
 *   # Apply:
 *   DRY_RUN=false DATABASE_URL="postgresql://..." npx tsx fix-jasmine-maurice-email-swap.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}\n`);

  // Find Jasmine Verriet — she currently has Maurice's email
  const jasmine = await prisma.shareholder.findFirst({
    where: {
      firstName: { contains: 'Jasmine', mode: 'insensitive' },
      lastName: { contains: 'Verriet', mode: 'insensitive' },
    },
    include: {
      coop: { select: { name: true } },
      registrations: { select: { id: true, quantity: true, status: true } },
    },
  });

  if (!jasmine) {
    console.log('ERROR: Could not find Jasmine Verriet. Aborting.');
    return;
  }

  console.log(`Found Jasmine: ${jasmine.firstName} ${jasmine.lastName}`);
  console.log(`  Coop: ${jasmine.coop.name}`);
  console.log(`  Type: ${jasmine.type}`);
  console.log(`  Email: ${jasmine.email}`);
  console.log(`  userId: ${jasmine.userId}`);
  console.log(`  registeredByUserId: ${jasmine.registeredByUserId}`);
  console.log(`  Registrations: ${jasmine.registrations.length}`);

  // Find Maurice in the same coop — her father
  const maurice = await prisma.shareholder.findFirst({
    where: {
      coopId: jasmine.coopId,
      firstName: { contains: 'Maurice', mode: 'insensitive' },
      lastName: { contains: 'Kennes', mode: 'insensitive' },
    },
    include: {
      registrations: { select: { id: true, quantity: true, status: true } },
    },
  });

  if (!maurice) {
    console.log('\nERROR: Could not find Maurice Kennes-Vanhove in the same coop. Aborting.');
    return;
  }

  console.log(`\nFound Maurice: ${maurice.firstName} ${maurice.lastName}`);
  console.log(`  Type: ${maurice.type}`);
  console.log(`  Email: ${maurice.email}`);
  console.log(`  userId: ${maurice.userId}`);
  console.log(`  Registrations: ${maurice.registrations.length}`);

  if (!maurice.userId) {
    console.log('\nERROR: Maurice has no userId — cannot link Jasmine as minor. Aborting.');
    return;
  }

  const realEmail = jasmine.email; // This is Maurice's real email, currently on Jasmine
  const modifiedEmail = maurice.email; // This is the modified email Maurice currently has

  console.log(`\nEmail swap plan:`);
  console.log(`  Jasmine: ${realEmail} -> null (standard for minors)`);
  console.log(`  Maurice: ${modifiedEmail} -> ${realEmail}`);
  console.log(`\nMinor setup plan:`);
  console.log(`  Jasmine type: ${jasmine.type} -> MINOR`);
  console.log(`  Jasmine registeredByUserId: ${jasmine.registeredByUserId || 'null'} -> ${maurice.userId}`);
  console.log(`  Jasmine userId: ${jasmine.userId || 'null'} -> null`);

  if (!DRY_RUN) {
    await prisma.$transaction(async (tx) => {
      // Step 1: Clear Jasmine's email first (to avoid unique constraint violation)
      await tx.shareholder.update({
        where: { id: jasmine.id },
        data: { email: null },
      });

      // Step 2: Set Maurice's email to the real one
      await tx.shareholder.update({
        where: { id: maurice.id },
        data: { email: realEmail!.toLowerCase() },
      });

      // Step 3: Set Jasmine as MINOR under Maurice
      await tx.shareholder.update({
        where: { id: jasmine.id },
        data: {
          type: 'MINOR',
          registeredByUserId: maurice.userId,
          userId: null,
        },
      });
    });

    console.log('\nAll changes applied successfully.');
  } else {
    console.log('\n(dry run — no changes made)');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
