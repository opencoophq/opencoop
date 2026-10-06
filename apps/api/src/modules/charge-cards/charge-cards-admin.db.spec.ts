import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@opencoop/database';
import { ChargeCardsAdminService } from './charge-cards-admin.service';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

describeDb('ChargeCardsAdminService (database)', () => {
  let prisma: PrismaClient;
  let email: { sendChargeCardIssued: jest.Mock };
  let service: ChargeCardsAdminService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    email = { sendChargeCardIssued: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsAdminService(prisma as any, email as any);
  });

  it('answers 409 when a second card is issued with a card number already used in the coop', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id);
    const first = await createTestChargeCard(prisma, coop.id, shareholder.id, { status: 'PAID' } as any);
    const second = await createTestChargeCard(prisma, coop.id, shareholder.id, { status: 'PAID' } as any);

    await service.issue(coop.id, first.id, 'NL-DUP-1');

    await expect(service.issue(coop.id, second.id, 'NL-DUP-1')).rejects.toThrow(ConflictException);

    const reread = await prisma.chargeCard.findUniqueOrThrow({ where: { id: second.id } });
    expect(reread.status).toBe('PAID');
    expect(reread.cardNumber).toBeNull();
  });

  it('refuses to unblock an ADMIN-blocked card whose shareholder is no longer ACTIVE', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id, 'INACTIVE');
    const blocked = await createTestChargeCard(prisma, coop.id, shareholder.id, {
      status: 'BLOCKED',
      blockReason: 'ADMIN',
    } as any);

    await expect(service.unblock(coop.id, blocked.id)).rejects.toThrow(BadRequestException);

    const reread = await prisma.chargeCard.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(reread.status).toBe('BLOCKED');
    expect(reread.blockReason).toBe('ADMIN');
  });

  it('returns 404 for a card id that belongs to another coop', async () => {
    const coopA = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const coopB = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholderB = await createTestShareholder(prisma, coopB.id);
    const cardInB = await createTestChargeCard(prisma, coopB.id, shareholderB.id, { status: 'ACTIVE' } as any);

    await expect(service.block(coopA.id, cardInB.id)).rejects.toThrow(NotFoundException);

    const reread = await prisma.chargeCard.findUniqueOrThrow({ where: { id: cardInB.id } });
    expect(reread.status).toBe('ACTIVE');
  });

  it('cancels a PAID card that already holds a payment: CANCELLED, replacesCardId cleared, the payment is untouched', async () => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id);
    const lost = await createTestChargeCard(prisma, coop.id, shareholder.id, {
      status: 'BLOCKED',
      blockReason: 'LOST',
    } as any);
    const replacement = await createTestChargeCard(prisma, coop.id, shareholder.id, {
      status: 'PAID',
      feeInclVat: 12,
      isReplacement: true,
      replacesCardId: lost.id,
    } as any);
    const payment = await prisma.payment.create({
      data: { coopId: coop.id, chargeCardId: replacement.id, amount: 12, bankDate: new Date() },
    });

    const result = await service.cancel(coop.id, replacement.id);

    expect(result.status).toBe('CANCELLED');
    expect(result.replacesCardId).toBeNull();
    const rereadPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(rereadPayment.chargeCardId).toBe(replacement.id);
    expect(Number(rereadPayment.amount)).toBe(12);
  });
});
