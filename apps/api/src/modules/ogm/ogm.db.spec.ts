import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { OgmService } from './ogm.service';
import {
  cleanupTestCoops,
  createTestCoop,
  createTestPrisma,
  createTestShareClass,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

const MIGRATION = path.resolve(
  __dirname,
  '../../../../../packages/database/prisma/migrations/20261005100000_coop_ogm_sequence/migration.sql',
);

describeDb('OGM sequence (database)', () => {
  let prisma: PrismaClient;
  let ogm: OgmService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    ogm = new OgmService(prisma as any);
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('hands out 25 distinct, consecutive codes when called concurrently', async () => {
    const coop = await createTestCoop(prisma);

    const codes = await Promise.all(
      Array.from({ length: 25 }, () => prisma.$transaction((tx) => ogm.nextOgmCode(tx, coop.id))),
    );

    expect(new Set(codes).size).toBe(25);
    const expected = Array.from({ length: 25 }, (_, i) => generateOgmCode(coop.ogmPrefix, i + 1));
    expect([...codes].sort()).toEqual(expected.sort());
    const after = await prisma.coop.findUniqueOrThrow({ where: { id: coop.id } });
    expect(after.ogmSequence).toBe(25);
  });

  it('backfills the counter from the highest parsed sequence, not from the registration count', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    for (const sequence of [3, 17, 9]) {
      await prisma.registration.create({
        data: {
          coopId: coop.id,
          shareholderId: shareholder.id,
          shareClassId: shareClass.id,
          type: 'BUY',
          quantity: 1,
          pricePerShare: 10,
          totalAmount: 10,
          registerDate: new Date(),
          ogmCode: generateOgmCode(coop.ogmPrefix, sequence),
        },
      });
    }

    const backfill = fs.readFileSync(MIGRATION, 'utf-8').split('-- BACKFILL')[1];
    await prisma.$executeRawUnsafe(backfill);

    const after = await prisma.coop.findUniqueOrThrow({ where: { id: coop.id } });
    expect(after.ogmSequence).toBe(17);
    await expect(prisma.$transaction((tx) => ogm.nextOgmCode(tx, coop.id))).resolves.toBe(
      generateOgmCode(coop.ogmPrefix, 18),
    );
  });
});
