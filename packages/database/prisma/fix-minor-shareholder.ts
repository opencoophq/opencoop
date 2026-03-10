/**
 * Fix minor shareholder records that share a userId with their parent.
 *
 * Problem: A parent and their minor child both have the same userId on their
 * Shareholder record. The dashboard shows shareholders[0], so if the minor
 * comes first, the parent only sees the daughter's shares.
 *
 * Fix: For the minor child, set type to MINOR, set registeredByUserId to the
 * parent's userId, and clear userId (minors don't need their own login).
 *
 * Usage:
 *   # First, run in DRY_RUN mode to see what would change:
 *   DATABASE_URL="postgresql://..." npx tsx fix-minor-shareholder.ts
 *
 *   # Then apply:
 *   DRY_RUN=false DATABASE_URL="postgresql://..." npx tsx fix-minor-shareholder.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}\n`);

  // Find all userIds that have more than one shareholder record
  const duplicates = await prisma.$queryRaw<{ userId: string; count: bigint }[]>`
    SELECT "userId", COUNT(*) as count
    FROM shareholders
    WHERE "userId" IS NOT NULL
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length === 0) {
    console.log('No users found with multiple shareholder records. Nothing to fix.');
    return;
  }

  console.log(`Found ${duplicates.length} user(s) with multiple shareholder records:\n`);

  for (const dup of duplicates) {
    const shareholders = await prisma.shareholder.findMany({
      where: { userId: dup.userId },
      include: {
        coop: { select: { name: true, slug: true } },
        registrations: { select: { id: true, quantity: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const user = await prisma.user.findUnique({
      where: { id: dup.userId },
      select: { id: true, name: true, email: true },
    });

    console.log(`User: ${user?.name} (${user?.email})`);
    console.log(`  Shareholder records:`);

    // Identify which is the parent (INDIVIDUAL) and which might be the minor
    let parentShareholder = shareholders.find((s) => s.type === 'INDIVIDUAL');
    const possibleMinors = shareholders.filter((s) => s !== parentShareholder);

    // If all are INDIVIDUAL, the youngest by name/context is likely the minor
    if (!parentShareholder) {
      // Default to first (oldest record) as parent
      parentShareholder = shareholders[0];
      console.log(`  WARNING: No INDIVIDUAL type found, assuming first record is parent`);
    }

    for (const sh of shareholders) {
      const isParent = sh === parentShareholder;
      const regCount = sh.registrations.length;
      const activeRegs = sh.registrations.filter(
        (r) => r.status === 'ACTIVE' || r.status === 'COMPLETED',
      ).length;

      console.log(
        `  - ${sh.firstName} ${sh.lastName} (${sh.type}, ${sh.status})` +
          ` | ${regCount} registrations (${activeRegs} active)` +
          ` | coop: ${sh.coop.name}` +
          (isParent ? ' [PARENT]' : ' [MINOR CANDIDATE]'),
      );
    }

    // Fix: for each minor candidate, update type and linkage
    for (const minor of possibleMinors) {
      console.log(`\n  Fix: ${minor.firstName} ${minor.lastName}`);
      console.log(`    - Set type: ${minor.type} -> MINOR`);
      console.log(`    - Set registeredByUserId: ${minor.registeredByUserId || 'null'} -> ${dup.userId}`);
      console.log(`    - Clear userId: ${minor.userId} -> null`);

      if (!DRY_RUN) {
        await prisma.shareholder.update({
          where: { id: minor.id },
          data: {
            type: 'MINOR',
            registeredByUserId: dup.userId,
            userId: null,
          },
        });
        console.log(`    Applied`);
      } else {
        console.log(`    (dry run - no changes made)`);
      }
    }

    console.log('');
  }

  console.log(DRY_RUN ? 'Dry run complete. Set DRY_RUN=false to apply.' : 'All fixes applied.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
