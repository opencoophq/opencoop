import { PrismaClient, ShareholderStatus } from '@opencoop/database';

/**
 * Helpers for *.db.spec.ts files. They run against the test Postgres
 * (docker-compose.test.yml, port 5433) after `prisma migrate deploy` + `db push`, and
 * skip when TEST_DATABASE_URL is not set (CI unit job, plain `pnpm test`).
 */
const url = process.env.TEST_DATABASE_URL;
const SLUG_PREFIX = 'dbtest-';
let counter = 0;

export const describeDb = url ? describe : describe.skip;

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: url });
}

export async function createTestCoop(prisma: PrismaClient) {
  counter += 1;
  const taken = new Set((await prisma.coop.findMany({ select: { ogmPrefix: true } })).map((c) => c.ogmPrefix));
  let prefix = 900;
  while (taken.has(String(prefix))) prefix += 1;
  return prisma.coop.create({
    data: { slug: `${SLUG_PREFIX}${Date.now()}-${counter}`, name: 'DB test coop', ogmPrefix: String(prefix) },
  });
}

export async function createTestShareholder(
  prisma: PrismaClient,
  coopId: string,
  status: ShareholderStatus = 'ACTIVE',
) {
  return prisma.shareholder.create({
    data: { coopId, type: 'INDIVIDUAL', status, firstName: 'Db', lastName: 'Test' },
  });
}

export async function createTestShareClass(prisma: PrismaClient, coopId: string) {
  return prisma.shareClass.create({ data: { coopId, name: 'A', code: 'A', pricePerShare: 10 } });
}

export async function cleanupTestCoops(prisma: PrismaClient) {
  const inTestCoop = { coop: { slug: { startsWith: SLUG_PREFIX } } };
  await prisma.payment.deleteMany({ where: inTestCoop });
  await prisma.registration.deleteMany({ where: inTestCoop });
  await prisma.coop.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
}
