import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@opencoop/database';
import { OgmService } from '../ogm/ogm.service';
import { transitionCard } from './charge-card-transition';
import { ChargeCardsService } from './charge-cards.service';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('ChargeCardsService concurrency (database)', () => {
  let prisma: PrismaClient;
  let service: ChargeCardsService;
  let email: { sendChargeCardCoopNotice: jest.Mock };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@dbtest.invalid' } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    email = { sendChargeCardCoopNotice: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsService(prisma as any, new OgmService(prisma as any), email as any);
  });

  it('two concurrent requests against one unreplaced LOST card produce exactly one replacement, and the other either a normal card or a 409', async () => {
    const coop = await createTestCoop(prisma, {
      chargeCardsEnabled: true,
      chargeCardFee: 6,
      chargeCardReplacementFee: 12,
    } as any);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const user = await prisma.user.create({ data: { email: `${shareholder.id}@dbtest.invalid` } });
    const userId = user.id;
    await prisma.shareholder.update({ where: { id: shareholder.id }, data: { userId } });
    const lost = await createTestChargeCard(prisma, coop.id, shareholder.id, {
      status: 'BLOCKED',
      blockReason: 'LOST',
      blockedAt: new Date(),
    } as any);

    const results = await Promise.allSettled([
      service.request(shareholder.id, userId, {}),
      service.request(shareholder.id, userId, {}),
    ]);

    // Both requests can only ever link the same LOST card once — the unique
    // index on replacesCardId lets exactly one through; the loser either
    // raced into a 409 or (if it ran after the first committed) simply saw
    // the LOST card already spoken for and created a normal card instead.
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.request>>
    >[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    const replacements = fulfilled.filter((r) => r.value.card.isReplacement);
    expect(replacements).toHaveLength(1);
    expect(replacements[0].value.card.replacesCardId).toBe(lost.id);
    expect(replacements[0].value.card.feeInclVat).toBe(12);

    if (rejected.length > 0) {
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(fulfilled).toHaveLength(1);
    } else {
      expect(fulfilled).toHaveLength(2);
      const normal = fulfilled.filter((r) => !r.value.card.isReplacement);
      expect(normal).toHaveLength(1);
      expect(normal[0].value.card.feeInclVat).toBe(6);
    }

    const cardsAfter = await prisma.chargeCard.findMany({ where: { shareholderId: shareholder.id } });
    expect(cardsAfter.filter((c) => c.replacesCardId === lost.id)).toHaveLength(1);
  });

  it('races a cancel against another transition on the same card: exactly one wins, the other is refused', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true } as any);
    const shareholder = await createTestShareholder(prisma, coop.id);
    const requested = await createTestChargeCard(prisma, coop.id, shareholder.id, { status: 'REQUESTED' } as any);

    const results = await Promise.allSettled([
      transitionCard(prisma as any, { id: requested.id }, { status: 'REQUESTED' }, { status: 'CANCELLED' }, 'cancel race A'),
      transitionCard(
        prisma as any,
        { id: requested.id },
        { status: 'REQUESTED' },
        { status: 'PAID', paidAt: new Date() },
        'cancel race B',
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);

    const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: requested.id } });
    expect(['CANCELLED', 'PAID']).toContain(after.status);
  });
});
