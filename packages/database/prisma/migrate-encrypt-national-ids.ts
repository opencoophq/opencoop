/**
 * Migration script to encrypt existing nationalId fields.
 *
 * Usage:
 *   FIELD_ENCRYPTION_KEY=<hex> npx tsx packages/database/prisma/migrate-encrypt-national-ids.ts
 *
 * Idempotent: already-encrypted values are skipped.
 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('FIELD_ENCRYPTION_KEY environment variable is required');
  }
  return Buffer.from(key, 'hex');
}

function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

function isEncrypted(value: string): boolean {
  if (value.length < 40) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH && value === decoded.toString('base64');
  } catch {
    return false;
  }
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // Encrypt shareholder nationalIds
    const shareholders = await prisma.shareholder.findMany({
      where: { nationalId: { not: null } },
      select: { id: true, nationalId: true },
    });

    let shareholderCount = 0;
    for (const sh of shareholders) {
      if (!sh.nationalId || isEncrypted(sh.nationalId)) continue;
      await prisma.shareholder.update({
        where: { id: sh.id },
        data: { nationalId: encryptField(sh.nationalId) },
      });
      shareholderCount++;
    }
    console.log(`Encrypted ${shareholderCount} shareholder nationalIds`);

    // Encrypt beneficial owner nationalIds
    const beneficialOwners = await prisma.beneficialOwner.findMany({
      where: { nationalId: { not: null } },
      select: { id: true, nationalId: true },
    });

    let boCount = 0;
    for (const bo of beneficialOwners) {
      if (!bo.nationalId || isEncrypted(bo.nationalId)) continue;
      await prisma.beneficialOwner.update({
        where: { id: bo.id },
        data: { nationalId: encryptField(bo.nationalId) },
      });
      boCount++;
    }
    console.log(`Encrypted ${boCount} beneficial owner nationalIds`);

    console.log('Migration complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
