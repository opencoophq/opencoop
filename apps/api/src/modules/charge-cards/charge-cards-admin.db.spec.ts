import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { AuditService } from '../audit/audit.service';
import { BankMatchingService } from '../bank-import/bank-matching.service';
import { OgmService } from '../ogm/ogm.service';
import { ChargeCardsAdminService } from './charge-cards-admin.service';
import {
  cleanupTestCoops,
  createTestChargeCard,
  createTestCoop,
  createTestPrisma,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

describeDb('ChargeCardsAdminService (database)', () => {
  let prisma: PrismaClient;
  let email: { sendChargeCardIssued: jest.Mock };
  let service: ChargeCardsAdminService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
  });

  afterAll(async () => {
    const actors = await prisma.user.findMany({ where: { email: { endsWith: '@dbtest.invalid' } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: actors.map((u) => u.id) } } });
    await cleanupTestCoops(prisma);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@dbtest.invalid' } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    email = { sendChargeCardIssued: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeCardsAdminService(prisma as any, email as any, new AuditService(prisma as any));
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

  describe('markPaid', () => {
    const setup = async () => {
      const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
      const shareholder = await createTestShareholder(prisma, coop.id);
      // A real OGM, so a later bank row resolves to this card.
      const card = await createTestChargeCard(prisma, coop.id, shareholder.id, {
        status: 'REQUESTED',
        feeInclVat: 6,
        ogmCode: generateOgmCode(coop.ogmPrefix, 1),
      } as any);
      const admin = await prisma.user.create({ data: { email: `admin-${card.id}@dbtest.invalid` } });
      return { coop, card, admin };
    };

    it('books one payment for the fee, marks the card PAID on the given day and audits it', async () => {
      const { coop, card, admin } = await setup();

      const result = await service.markPaid(
        coop.id,
        card.id,
        { paidAt: '2026-11-02', method: 'CASH', note: 'Contant betaald op de infoavond' },
        admin.id,
      );

      expect(result.status).toBe('PAID');
      const reread = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(reread.paidAt).toEqual(new Date('2026-11-02T00:00:00.000Z'));
      const payments = await prisma.payment.findMany({ where: { chargeCardId: card.id } });
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].amount)).toBe(6);
      expect(payments[0].bankTransactionId).toBeNull();
      expect(payments[0].matchedByUserId).toBe(admin.id);
      const logs = await prisma.auditLog.findMany({ where: { entity: 'ChargeCard', entityId: card.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'UPDATE', actorId: admin.id, coopId: coop.id });
      expect(logs[0].changes).toEqual(
        expect.arrayContaining([
          { field: 'status', oldValue: 'REQUESTED', newValue: 'PAID' },
          { field: 'paymentMethod', oldValue: null, newValue: 'CASH' },
          { field: 'note', oldValue: null, newValue: 'Contant betaald op de infoavond' },
        ]),
      );
    });

    it('tops up a partial payment so the total equals the fee', async () => {
      const { coop, card, admin } = await setup();
      await prisma.payment.create({
        data: { coopId: coop.id, chargeCardId: card.id, amount: 2.5, bankDate: new Date() },
      });

      await service.markPaid(coop.id, card.id, { method: 'BANK_TRANSFER' }, admin.id);

      const payments = await prisma.payment.findMany({ where: { chargeCardId: card.id } });
      expect(payments.map((p) => Number(p.amount)).sort()).toEqual([2.5, 3.5]);
    });

    it('answers 409 on a second call and keeps a single payment', async () => {
      const { coop, card, admin } = await setup();
      await service.markPaid(coop.id, card.id, { method: 'CASH' }, admin.id);

      await expect(service.markPaid(coop.id, card.id, { method: 'CASH' }, admin.id)).rejects.toThrow(
        ConflictException,
      );
      expect(await prisma.payment.count({ where: { chargeCardId: card.id } })).toBe(1);
    });

    it('leaves a later bank transfer with the card OGM UNMATCHED, without a second payment', async () => {
      const { coop, card, admin } = await setup();
      await service.markPaid(coop.id, card.id, { method: 'OTHER' }, admin.id);
      const ogm = new OgmService(prisma as any);
      const payments = { addPayment: jest.fn(() => Promise.reject(new Error('addPayment called for a card'))) };
      const matcher = new BankMatchingService(prisma as any, payments as any, ogm);
      const row = await prisma.bankTransaction.create({
        data: { coopId: coop.id, date: new Date(), amount: 6, ogmCode: card.ogmCode },
      });

      const result = await matcher.matchTransaction(coop.id, row, admin.id);

      expect(result).toEqual({ status: 'UNMATCHED', linkedExisting: false, createdPayment: false });
      expect(await prisma.payment.count({ where: { chargeCardId: card.id } })).toBe(1);
      const rereadRow = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(rereadRow.matchStatus).toBe('UNMATCHED');
    });

    it('returns 404 for a card of another coop', async () => {
      const { card, admin } = await setup();
      const other = await createTestCoop(prisma, { chargeCardsEnabled: true });

      await expect(service.markPaid(other.id, card.id, { method: 'CASH' }, admin.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
