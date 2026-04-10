/**
 * sync-brevo-contacts.ts
 *
 * Syncs OpenCoop contact segments to Brevo contact lists via Brevo API v3.
 *
 * Segments:
 *   S1 - "S1 Actieve cooperanten": Active members with 1–4 net shares
 *   S2 - "S2 Grote investeerders": Active members with 5+ net shares
 *   S3 - "S3 Niet-leden": Non-members / no-share accounts (inactive + pending sign-ups subscribed 6+ months ago)
 *
 * Usage:
 *   DATABASE_URL=<prod-db-url> BREVO_API_KEY=<key> tsx agents/founding-engineer/scripts/sync-brevo-contacts.ts
 *
 * Env vars:
 *   DATABASE_URL     - PostgreSQL connection string (use SSH tunnel for prod)
 *   BREVO_API_KEY    - Brevo API key (Settings → API Keys)
 *   COOP_SLUG        - OpenCoop cooperative slug (default: "bronsgroen")
 *   DRY_RUN          - Set to "true" to print segments without calling Brevo API
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BREVO_BASE_URL = 'https://api.brevo.com/v3';
const COOP_SLUG = process.env.COOP_SLUG ?? 'bronsgroen';
const DRY_RUN = process.env.DRY_RUN === 'true';

interface BrevoContact {
  email: string;
  attributes: {
    FIRSTNAME?: string;
    LASTNAME?: string;
    [key: string]: string | undefined;
  };
}

interface Segment {
  listName: string;
  contacts: BrevoContact[];
}

// ── Brevo API helpers ────────────────────────────────────────────────────────

async function brevoGet(path: string): Promise<any> {
  const res = await fetch(`${BREVO_BASE_URL}${path}`, {
    headers: {
      'api-key': process.env.BREVO_API_KEY!,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Brevo GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function brevoPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${BREVO_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Find an existing Brevo list by name, or create it. Returns the list ID. */
async function findOrCreateList(name: string): Promise<number> {
  const data = await brevoGet('/contacts/lists?limit=50&offset=0');
  const lists: Array<{ id: number; name: string }> = data.lists ?? [];
  const existing = lists.find((l) => l.name === name);
  if (existing) {
    console.log(`  Found existing list "${name}" (id=${existing.id})`);
    return existing.id;
  }

  // Brevo Basic plan only supports a fixed number of lists — create if not found
  const created = await brevoPost('/contacts/lists', { name });
  console.log(`  Created list "${name}" (id=${created.id})`);
  return created.id;
}

/** Bulk upsert contacts into a Brevo list. Returns the async job URL. */
async function importContacts(listId: number, contacts: BrevoContact[]): Promise<string> {
  const result = await brevoPost('/contacts/importContacts', {
    jsonBody: contacts,
    listIds: [listId],
    updateExistingContacts: true,
    emptyContactsAttributes: false,
  });
  return result.processId ?? result.jobId ?? '(no job id returned)';
}

// ── OpenCoop query ────────────────────────────────────────────────────────────

async function buildSegments(): Promise<Segment[]> {
  // 1. Find the coop
  const coop = await prisma.coop.findUnique({ where: { slug: COOP_SLUG } });
  if (!coop) throw new Error(`Coop "${COOP_SLUG}" not found in database`);
  console.log(`\nCoop: ${coop.name} (${coop.id})\n`);

  // 2. Load all shareholders with their user and net share count
  //    Net shares = SUM of COMPLETED BUY quantities - SUM of COMPLETED SELL quantities
  const shareholders = await prisma.shareholder.findMany({
    where: { coopId: coop.id },
    include: {
      user: { select: { email: true } },
      registrations: {
        where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
        select: { type: true, quantity: true },
      },
    },
  });

  // 3. Compute net shares per shareholder
  type ShareholderRow = {
    email: string;
    firstName: string;
    lastName: string;
    netShares: number;
    status: string;
    createdAt: Date;
  };

  const rows: ShareholderRow[] = [];

  for (const sh of shareholders) {
    const email = sh.user?.email ?? null;
    if (!email) continue; // skip imported shareholders without an account

    const firstName = sh.firstName ?? sh.companyName ?? '';
    const lastName = sh.lastName ?? '';

    const bought = sh.registrations
      .filter((r) => r.type === 'BUY')
      .reduce((sum, r) => sum + r.quantity, 0);
    const sold = sh.registrations
      .filter((r) => r.type === 'SELL')
      .reduce((sum, r) => sum + r.quantity, 0);
    const netShares = bought - sold;

    rows.push({ email, firstName, lastName, netShares, status: sh.status, createdAt: sh.createdAt });
  }

  // 4. Build segments
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const s1: BrevoContact[] = [];
  const s2: BrevoContact[] = [];
  const s3: BrevoContact[] = [];

  for (const row of rows) {
    const contact: BrevoContact = {
      email: row.email,
      attributes: {
        FIRSTNAME: row.firstName || undefined,
        LASTNAME: row.lastName || undefined,
      },
    };

    if (row.status === 'ACTIVE' && row.netShares >= 1 && row.netShares <= 4) {
      s1.push(contact);
    } else if (row.status === 'ACTIVE' && row.netShares >= 5) {
      s2.push(contact);
    } else if (row.netShares === 0 && row.createdAt <= sixMonthsAgo) {
      // Non-members / ex-members subscribed 6+ months ago (S3/S4 combined)
      s3.push(contact);
    }
  }

  console.log(`Segment counts:`);
  console.log(`  S1 Actieve cooperanten (1–4 shares): ${s1.length}`);
  console.log(`  S2 Grote investeerders (5+ shares):  ${s2.length}`);
  console.log(`  S3 Niet-leden (0 shares, 6m+):       ${s3.length}`);

  return [
    { listName: 'S1 Actieve cooperanten', contacts: s1 },
    { listName: 'S2 Grote investeerders', contacts: s2 },
    { listName: 'S3 Niet-leden', contacts: s3 },
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.BREVO_API_KEY && !DRY_RUN) {
    console.error('Error: BREVO_API_KEY is required (or set DRY_RUN=true)');
    process.exit(1);
  }

  console.log(`=== Brevo Contact Sync (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===`);

  const segments = await buildSegments();

  if (DRY_RUN) {
    console.log('\nDry run — skipping Brevo API calls.');
    for (const seg of segments) {
      console.log(`\n${seg.listName} (${seg.contacts.length} contacts):`);
      seg.contacts.slice(0, 3).forEach((c) =>
        console.log(`  ${c.email} — ${c.attributes.FIRSTNAME} ${c.attributes.LASTNAME}`)
      );
      if (seg.contacts.length > 3) console.log(`  ... and ${seg.contacts.length - 3} more`);
    }
    return;
  }

  console.log('\nSyncing to Brevo...\n');

  for (const seg of segments) {
    if (seg.contacts.length === 0) {
      console.log(`Skipping "${seg.listName}" — no contacts.`);
      continue;
    }

    console.log(`\nProcessing "${seg.listName}"...`);
    const listId = await findOrCreateList(seg.listName);
    const jobId = await importContacts(listId, seg.contacts);
    console.log(`  Submitted import job: ${jobId}`);
    console.log(`  ${seg.contacts.length} contacts queued for list id=${listId}`);
  }

  console.log('\n=== Done ===');
  console.log('Import jobs run asynchronously. Check Brevo → Contacts → Import History for status.');
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
