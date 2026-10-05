import { PrismaClient } from '@opencoop/database';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareClass,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('payments_exactly_one_target_check (database)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  it('rejects a payment that belongs to nothing', async () => {
    const coop = await createTestCoop(prisma);

    await expect(
      prisma.payment.create({ data: { coopId: coop.id, amount: 6, bankDate: new Date() } }),
    ).rejects.toThrow(/payments_exactly_one_target_check/);
  });

  it('rejects a payment that belongs to a registration and a charge card', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    const registration = await prisma.registration.create({
      data: {
        coopId: coop.id, shareholderId: shareholder.id, shareClassId: shareClass.id, type: 'BUY',
        quantity: 1, pricePerShare: 10, totalAmount: 10, registerDate: new Date(),
      },
    });
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id);

    await expect(
      prisma.payment.create({
        data: { coopId: coop.id, registrationId: registration.id, chargeCardId: card.id, amount: 6, bankDate: new Date() },
      }),
    ).rejects.toThrow(/payments_exactly_one_target_check/);
  });

  it('accepts a payment that belongs to a charge card only', async () => {
    const coop = await createTestCoop(prisma);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id);

    const payment = await prisma.payment.create({
      data: { coopId: coop.id, chargeCardId: card.id, amount: 6, bankDate: new Date() },
    });

    expect(payment.registrationId).toBeNull();
    expect(payment.chargeCardId).toBe(card.id);
  });
});
