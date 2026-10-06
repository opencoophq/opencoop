import { PrismaClient } from '@opencoop/database';
import { ChargeCardSyncService } from './charge-card-sync.service';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('ChargeCardSyncService (database)', () => {
  let prisma: PrismaClient;
  let sync: ChargeCardSyncService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    sync = new ChargeCardSyncService(prisma as any);
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('blocks, unblocks and cancels by shareholder status, and leaves other cards alone', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const gone = await createTestShareholder(prisma, coop.id, 'INACTIVE');
    const back = await createTestShareholder(prisma, coop.id, 'ACTIVE');

    const activeOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'ACTIVE' });
    const requestedOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'REQUESTED' });
    const lostOfGone = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'BLOCKED', blockReason: 'LOST' });
    const noSharesOfBack = await createTestChargeCard(prisma, coop.id, back.id, { status: 'BLOCKED', blockReason: 'NO_SHARES' });
    const adminBlockOfBack = await createTestChargeCard(prisma, coop.id, back.id, { status: 'BLOCKED', blockReason: 'ADMIN' });

    const result = await sync.syncShareholder(gone.id);
    expect(result).toEqual({ blocked: 1, unblocked: 0, cancelled: 1 });
    await sync.syncShareholder(back.id);

    const read = (id: string) => prisma.chargeCard.findUniqueOrThrow({ where: { id } });
    expect(await read(activeOfGone.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'NO_SHARES', providerSyncNeeded: true });
    expect(await read(requestedOfGone.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await read(lostOfGone.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'LOST' });
    expect(await read(noSharesOfBack.id)).toMatchObject({ status: 'ACTIVE', blockReason: null, providerSyncNeeded: true });
    expect((await read(noSharesOfBack.id)).activatedAt).not.toBeNull();
    expect(await read(adminBlockOfBack.id)).toMatchObject({ status: 'BLOCKED', blockReason: 'ADMIN' });
  });

  it('keeps providerSyncNeeded when the status flaps before the admin acts', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id, 'ACTIVE');
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id, { status: 'ACTIVE' });

    await prisma.shareholder.update({ where: { id: shareholder.id }, data: { status: 'INACTIVE' } });
    await sync.syncAll();
    await prisma.shareholder.update({ where: { id: shareholder.id }, data: { status: 'ACTIVE' } });
    await sync.syncAll();

    expect(await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      status: 'ACTIVE',
      blockReason: null,
      providerSyncNeeded: true,
    });
  });

  it('leaves a REQUESTED card REQUESTED, uncancelled, when it already holds a payment', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const gone = await createTestShareholder(prisma, coop.id, 'INACTIVE');

    const card = await createTestChargeCard(prisma, coop.id, gone.id, { status: 'REQUESTED', feeInclVat: 6 });
    await prisma.payment.create({
      data: { chargeCardId: card.id, coopId: coop.id, amount: 3, bankDate: new Date() },
    });

    const result = await sync.syncShareholder(gone.id);

    expect(result).toEqual({ blocked: 0, unblocked: 0, cancelled: 0 });
    expect(await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      status: 'REQUESTED',
    });
  });
});
