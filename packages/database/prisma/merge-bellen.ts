/**
 * Merge the duplicate Christiane Bellen registration into her canonical
 * shareholder record on Bronsgroen.
 *
 * Today (2026-04-25) she made a 1-share purchase via the new account
 * (bellen.chris+2@telenet.be). That Registration + any Payment(s) need to be
 * re-pointed to the canonical shareholder (bellen.chris@telenet.be), and
 * then the duplicate Shareholder + User can be deleted cleanly.
 *
 * Operations (all in one $transaction):
 *  1. Move every Registration from new → old (Payments follow because they
 *     reference registrationId, not shareholderId).
 *  2. Delete any MeetingAttendance / Vote / Proxy (granted or held) attached
 *     to the new shareholder — the old already has its own attendance for
 *     the May 9 meeting, and proxies for a duplicate identity are nonsense.
 *  3. Delete the new Shareholder.
 *  4. Delete the new User account (now orphaned).
 *
 * Safety:
 *  - Defaults to DRY_RUN. Print everything, change nothing.
 *  - Aborts if either record is missing or they're in different coops.
 *  - Aborts if the new shareholder has anything we don't know how to handle
 *    (e.g. dividend payouts, documents, beneficial owners) — those need
 *    manual review.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx merge-bellen.ts
 *   DRY_RUN=false DATABASE_URL="..." npx tsx merge-bellen.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';
const OLD_EMAIL = 'bellen.chris@telenet.be';
const NEW_EMAIL = 'bellen.chris+2@telenet.be';
const COOP_SLUG = 'bronsgroen';

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Old (canonical): ${OLD_EMAIL}`);
  console.log(`New (duplicate): ${NEW_EMAIL}`);
  console.log(`Coop: ${COOP_SLUG}\n`);

  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) {
    console.log(`ERROR: coop "${COOP_SLUG}" not found.`);
    return;
  }

  const oldSh = await prisma.shareholder.findFirst({
    where: { coopId: coop.id, email: OLD_EMAIL },
    include: {
      registrations: { include: { payments: true } },
    },
  });
  const newSh = await prisma.shareholder.findFirst({
    where: { coopId: coop.id, email: NEW_EMAIL },
    include: {
      registrations: { include: { payments: true } },
      meetingAttendances: true,
      votes: true,
      proxiesGranted: true,
      proxiesHeld: true,
      dividendPayouts: true,
      documents: true,
      beneficialOwners: true,
    },
  });

  if (!oldSh) {
    console.log(`ERROR: canonical shareholder ${OLD_EMAIL} not found in ${COOP_SLUG}.`);
    return;
  }
  if (!newSh) {
    console.log(`ERROR: duplicate shareholder ${NEW_EMAIL} not found in ${COOP_SLUG}.`);
    return;
  }

  console.log('--- DISCOVERY ---');
  console.log(`Old: ${oldSh.id} ${oldSh.firstName} ${oldSh.lastName} (status=${oldSh.status})`);
  console.log(`     Registrations: ${oldSh.registrations.length}`);
  console.log(`     User: ${oldSh.userId ?? '(none)'}`);
  console.log(`New: ${newSh.id} ${newSh.firstName} ${newSh.lastName} (status=${newSh.status})`);
  console.log(`     Registrations: ${newSh.registrations.length}`);
  for (const r of newSh.registrations) {
    console.log(
      `       • ${r.id} type=${r.type} status=${r.status} qty=${r.quantity} amount=${r.totalAmount} payments=${r.payments.length}`,
    );
    for (const p of r.payments) {
      console.log(`          payment ${p.id} amount=${p.amount} bankDate=${p.bankDate.toISOString()}`);
    }
  }
  console.log(`     MeetingAttendances: ${newSh.meetingAttendances.length}`);
  console.log(`     Votes: ${newSh.votes.length}`);
  console.log(`     Proxies granted: ${newSh.proxiesGranted.length}`);
  console.log(`     Proxies held: ${newSh.proxiesHeld.length}`);
  console.log(`     DividendPayouts: ${newSh.dividendPayouts.length}`);
  console.log(`     Documents: ${newSh.documents.length}`);
  console.log(`     BeneficialOwners: ${newSh.beneficialOwners.length}`);
  console.log(`     User: ${newSh.userId ?? '(none)'}`);

  // Sanity gates: anything we don't explicitly handle below is a manual case.
  if (newSh.dividendPayouts.length > 0) {
    console.log(
      `\nABORT: duplicate shareholder has ${newSh.dividendPayouts.length} DividendPayout(s). Move those manually first.`,
    );
    return;
  }
  if (newSh.documents.length > 0) {
    console.log(
      `\nABORT: duplicate shareholder has ${newSh.documents.length} Document(s). Move them manually first.`,
    );
    return;
  }
  if (newSh.beneficialOwners.length > 0) {
    console.log(
      `\nABORT: duplicate shareholder has ${newSh.beneficialOwners.length} BeneficialOwner(s). Move them manually first.`,
    );
    return;
  }
  if (newSh.proxiesHeld.length > 0) {
    console.log(
      `\nABORT: duplicate shareholder is the *delegate* on ${newSh.proxiesHeld.length} Proxy(s). Other shareholders trusted them — manual review needed.`,
    );
    return;
  }

  const newUser = newSh.userId
    ? await prisma.user.findUnique({ where: { id: newSh.userId } })
    : null;

  console.log('\n--- PLAN ---');
  console.log(
    `1. Re-point ${newSh.registrations.length} Registration(s) from new (${newSh.id}) → old (${oldSh.id}). Payments follow automatically.`,
  );
  if (newSh.meetingAttendances.length > 0) {
    console.log(`2. Delete ${newSh.meetingAttendances.length} MeetingAttendance(s) on new (old already has its own).`);
  }
  if (newSh.votes.length > 0) {
    console.log(`3. Delete ${newSh.votes.length} Vote(s) on new.`);
  }
  if (newSh.proxiesGranted.length > 0) {
    console.log(`4. Delete ${newSh.proxiesGranted.length} Proxy(s) granted by new.`);
  }
  console.log(`5. Delete the new Shareholder ${newSh.id}.`);
  if (newUser) {
    console.log(`6. Delete the new User ${newUser.id} (${newUser.email}).`);
  }

  if (DRY_RUN) {
    console.log('\n(dry run — no changes made)');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Move registrations to the canonical shareholder.
    for (const reg of newSh.registrations) {
      await tx.registration.update({
        where: { id: reg.id },
        data: { shareholderId: oldSh.id },
      });
    }

    // 2. Clean up duplicate meeting state.
    if (newSh.meetingAttendances.length > 0) {
      await tx.meetingAttendance.deleteMany({ where: { shareholderId: newSh.id } });
    }
    if (newSh.votes.length > 0) {
      await tx.vote.deleteMany({ where: { shareholderId: newSh.id } });
    }
    if (newSh.proxiesGranted.length > 0) {
      await tx.proxy.deleteMany({ where: { grantorShareholderId: newSh.id } });
    }

    // 3. Delete the duplicate shareholder.
    await tx.shareholder.delete({ where: { id: newSh.id } });

    // 4. Delete the now-orphan user account.
    if (newUser) {
      await tx.user.delete({ where: { id: newUser.id } });
    }
  });

  console.log('\nMerge complete.');
  console.log(
    `Verify on the admin UI: ${oldSh.firstName} ${oldSh.lastName} should now show ${oldSh.registrations.length + newSh.registrations.length} registration(s) total.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
