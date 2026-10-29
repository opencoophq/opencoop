/**
 * Delete the duplicate Bellen registration on Bronsgroen.
 *
 * Problem: Christiane Bellen exists in the migrated Bronsgroen register
 * (orphan or with old email). She just registered fresh with
 * bellen.chris@telenet.be, which the system didn't recognize as a
 * duplicate (email-only match), so a NEW Shareholder + Registration +
 * User were created. We want to delete the new records; the operator
 * updates the OLD Shareholder's email + userId separately via the
 * admin UI so Christiane's historical shares stay intact.
 *
 * Safety:
 *  - Defaults to DRY_RUN. Print everything, modify nothing.
 *  - Aborts if the new Shareholder has any Payment in PAID/MATCHED state,
 *    any Transaction, or any Share rows — those need manual review, not
 *    blanket deletion.
 *  - All deletes wrapped in a single $transaction so a failure rolls back.
 *
 * Usage:
 *   # Dry run (default — recommended first):
 *   DATABASE_URL="postgresql://..." npx tsx delete-duplicate-bellen.ts
 *
 *   # Apply:
 *   DRY_RUN=false DATABASE_URL="postgresql://..." npx tsx delete-duplicate-bellen.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';
const DUPLICATE_EMAIL = 'bellen.chris@telenet.be';
const COOP_SLUG = 'bronsgroen';

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Target: ${DUPLICATE_EMAIL} on coop "${COOP_SLUG}"\n`);

  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) {
    console.log(`ERROR: Coop "${COOP_SLUG}" not found. Aborting.`);
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: DUPLICATE_EMAIL.toLowerCase() },
  });

  const shareholdersByEmail = await prisma.shareholder.findMany({
    where: { coopId: coop.id, email: DUPLICATE_EMAIL.toLowerCase() },
    include: {
      registrations: true,
      payments: true,
      transactions: true,
    },
  });

  const shareholdersByUser = user
    ? await prisma.shareholder.findMany({
        where: { coopId: coop.id, userId: user.id },
        include: {
          registrations: true,
          payments: true,
          transactions: true,
        },
      })
    : [];

  // De-dupe (a row can match both)
  const seen = new Set<string>();
  const newShareholders = [...shareholdersByEmail, ...shareholdersByUser].filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const registrationsByEmail = await prisma.registration.findMany({
    where: { coopId: coop.id, email: DUPLICATE_EMAIL.toLowerCase() },
  });

  console.log('--- DISCOVERY ---');
  console.log(`User account: ${user ? `${user.id} (${user.email})` : '(none)'}`);
  console.log(`New Shareholder rows: ${newShareholders.length}`);
  for (const sh of newShareholders) {
    console.log(`  • ${sh.id} — ${sh.firstName} ${sh.lastName}, type=${sh.type}, status=${sh.status}, email=${sh.email}`);
    console.log(`    Registrations: ${sh.registrations.length}`);
    console.log(`    Payments: ${sh.payments.length} (statuses: ${sh.payments.map((p) => p.status).join(', ') || '—'})`);
    console.log(`    Transactions: ${sh.transactions.length}`);
  }
  console.log(`Registrations matched by email (regardless of shareholderId): ${registrationsByEmail.length}`);
  for (const r of registrationsByEmail) {
    console.log(`  • ${r.id} — status=${r.status}, quantity=${r.quantity}, shareholderId=${r.shareholderId ?? '—'}`);
  }

  // Safety gates
  for (const sh of newShareholders) {
    const paidPayments = sh.payments.filter((p) => p.status === 'PAID' || p.status === 'MATCHED');
    if (paidPayments.length > 0) {
      console.log(`\nABORT: Shareholder ${sh.id} has ${paidPayments.length} PAID/MATCHED Payment(s). This is real money — manual review required.`);
      return;
    }
    if (sh.transactions.length > 0) {
      console.log(`\nABORT: Shareholder ${sh.id} has ${sh.transactions.length} Transaction(s). Shares were assigned — manual review required.`);
      return;
    }
  }

  console.log('\n--- PLAN ---');
  for (const sh of newShareholders) {
    console.log(`Delete Shareholder ${sh.id} and ${sh.registrations.length} Registration(s) + ${sh.payments.length} Payment(s) tied to it`);
  }
  const orphanRegs = registrationsByEmail.filter(
    (r) => !newShareholders.some((sh) => sh.registrations.some((sr) => sr.id === r.id)),
  );
  if (orphanRegs.length > 0) {
    console.log(`Delete ${orphanRegs.length} Registration(s) by email (not tied to any new Shareholder)`);
  }
  if (user) {
    console.log(
      `Delete User ${user.id} (so Christiane can re-register or be re-linked via magic-link to the OLD Shareholder later)`,
    );
  }

  console.log(
    '\nNOTE: This script does NOT touch the OLD canonical Bellen shareholder. Update its email + userId via the admin UI separately.',
  );

  if (DRY_RUN) {
    console.log('\n(dry run — no changes made)');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Delete unpaid Payments first to satisfy FK constraints.
    for (const sh of newShareholders) {
      if (sh.payments.length > 0) {
        await tx.payment.deleteMany({ where: { shareholderId: sh.id } });
      }
      // Delete Registrations tied to this Shareholder.
      if (sh.registrations.length > 0) {
        await tx.registration.deleteMany({ where: { shareholderId: sh.id } });
      }
    }
    // Orphan registrations (email-matched but no shareholder, e.g. registration that never reached payment).
    for (const r of orphanRegs) {
      await tx.registration.delete({ where: { id: r.id } });
    }
    // Now the Shareholder rows themselves.
    for (const sh of newShareholders) {
      await tx.shareholder.delete({ where: { id: sh.id } });
    }
    // Finally the User. Safe to leave in place too, but cleaner to remove
    // so Christiane gets a fresh magic-link flow against the OLD Shareholder
    // once you've updated its email.
    if (user) {
      await tx.user.delete({ where: { id: user.id } });
    }
  });

  console.log('\nAll changes applied successfully.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
