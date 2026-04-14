// Run BEFORE deploying to prod. Reports data that would become inconsistent
// with the shared-email-households model.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 OpenCoop Household Data Audit\n');

  // 1. Orphan shareholders: email set, no User link
  const orphans = await prisma.shareholder.findMany({
    where: { email: { not: null }, userId: null },
    select: { id: true, email: true, coopId: true },
  });
  console.log(`✓ Orphan shareholders (email, no User): ${orphans.length}`);
  if (orphans.length > 0 && orphans.length <= 20) {
    console.log('  Sample:', orphans.slice(0, 5));
  } else if (orphans.length > 20) {
    console.log('  WARNING: Large orphan count. Sample:', orphans.slice(0, 5));
  }

  // 2. Divergent emails: shareholder.email != user.email (case-insensitive)
  const diverged = await prisma.$queryRaw<
    Array<{
      id: string;
      sh_email: string;
      user_email: string;
      coopId: string;
    }>
  >`
    SELECT s.id, s.email AS sh_email, u.email AS user_email, s."coopId"
    FROM shareholders s
    JOIN users u ON s."userId" = u.id
    WHERE s.email IS NOT NULL AND LOWER(s.email) != LOWER(u.email)
  `;
  console.log(
    `✓ Shareholder.email != User.email divergences: ${diverged.length}`
  );
  if (diverged.length > 0 && diverged.length <= 20) {
    console.log('  Sample:', diverged.slice(0, 5));
  } else if (diverged.length > 20) {
    console.log('  WARNING: Significant divergence detected. Sample:', diverged.slice(0, 5));
  }

  // 3. Existing multi-shareholder Users (candidate households)
  const households = await prisma.$queryRaw<
    Array<{
      userId: string;
      coopId: string;
      n: bigint;
    }>
  >`
    SELECT "userId", "coopId", COUNT(*) AS n
    FROM shareholders
    WHERE "userId" IS NOT NULL
    GROUP BY "userId", "coopId"
    HAVING COUNT(*) > 1
  `;
  console.log(
    `✓ Users with >1 shareholder in same coop (existing households): ${households.length}`
  );
  if (households.length > 0 && households.length <= 20) {
    console.log(
      '  Sample:',
      households.slice(0, 5).map((h) => ({
        userId: h.userId,
        coopId: h.coopId,
        n: Number(h.n),
      }))
    );
  } else if (households.length > 20) {
    console.log(
      '  NOTE: Significant household count detected. Sample:',
      households.slice(0, 5).map((h) => ({
        userId: h.userId,
        coopId: h.coopId,
        n: Number(h.n),
      }))
    );
  }

  // 4. In-coop duplicate emails (should be zero given unique constraint on non-null emails)
  const dupes = await prisma.$queryRaw<
    Array<{
      coopId: string;
      email: string;
      n: bigint;
    }>
  >`
    SELECT "coopId", LOWER(email) AS email, COUNT(*) AS n
    FROM shareholders
    WHERE email IS NOT NULL
    GROUP BY "coopId", LOWER(email)
    HAVING COUNT(*) > 1
  `;
  console.log(
    `✓ In-coop duplicate emails (should be 0): ${dupes.length}`
  );
  if (dupes.length > 0) {
    console.log('  ⚠️  DATA INTEGRITY ISSUE — investigate:', dupes);
  }

  // 5. Linked shareholders (the shared-email-household pattern in action)
  // These are shareholders with email=null but userId set (Task 3+ households)
  const linked = await prisma.shareholder.count({
    where: { email: null, userId: { not: null } },
  });
  console.log(
    `✓ Linked shareholders (email=null, userId=set — Task 3+ households): ${linked}`
  );

  // 6. Pending emancipation tokens by reason
  const tokens = await prisma.shareholderEmancipationToken.groupBy({
    by: ['reason'],
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    _count: true,
  });
  console.log(`✓ Pending emancipation tokens by reason:`);
  if (tokens.length === 0) {
    console.log('  None');
  } else {
    tokens.forEach((t) => {
      console.log(`  ${t.reason}: ${t._count}`);
    });
  }

  // 7. Summary and health check
  console.log('\n📊 Summary:');
  console.log(`  Total shareholders: ${await prisma.shareholder.count()}`);
  console.log(
    `  Shareholders with email: ${await prisma.shareholder.count({
      where: { email: { not: null } },
    })}`
  );
  console.log(
    `  Shareholders with User link: ${await prisma.shareholder.count({
      where: { userId: { not: null } },
    })}`
  );
  console.log(
    `  Total users: ${await prisma.user.count()}`
  );

  console.log('\n✅ Audit complete.');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Audit error:', e);
  process.exit(1);
});
