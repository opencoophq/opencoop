import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@opencoop/database';
import { generateOgmCode } from '@opencoop/shared';
import { BankImportService } from '../bank-import/bank-import.service';
import { BankMatchingService } from '../bank-import/bank-matching.service';
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

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

describeDb('charge card payments under concurrency (database)', () => {
  let prisma: PrismaClient;
  let ogm: OgmService;
  let matcher: BankMatchingService;
  let bankImport: BankImportService;
  let cards: ChargeCardsService;
  const userId = null as unknown as string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
    ogm = new OgmService(prisma as any);
    // PaymentsService is registration-only; a card payment must never reach it.
    const payments = { addPayment: jest.fn(() => Promise.reject(new Error('addPayment called for a card'))) };
    matcher = new BankMatchingService(prisma as any, payments as any, ogm);
    bankImport = new BankImportService(prisma as any, {} as any, {} as any, matcher, ogm);
    const email = { sendChargeCardCoopNotice: jest.fn().mockResolvedValue(undefined) };
    cards = new ChargeCardsService(prisma as any, ogm, email as any);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@dbtest.invalid' } } });
    await prisma.$disconnect();
  });

  const setup = async (fee = 6) => {
    const coop = await createTestCoop(prisma, { chargeCardsEnabled: true });
    const shareholder = await createTestShareholder(prisma, coop.id);
    // A real OGM, so the matcher resolves the bank row to this card.
    const card = await createTestChargeCard(prisma, coop.id, shareholder.id, {
      status: 'REQUESTED',
      feeInclVat: fee,
      ogmCode: generateOgmCode(coop.ogmPrefix, 1),
    } as any);
    return { coop, card, shareholder };
  };

  /** A card whose shareholder has a login, so ChargeCardsService.cancel accepts the caller. */
  const setupOwned = async () => {
    const owned = await setup();
    const user = await prisma.user.create({ data: { email: `${owned.shareholder.id}@dbtest.invalid` } });
    await prisma.shareholder.update({ where: { id: owned.shareholder.id }, data: { userId: user.id } });
    return { ...owned, userId: user.id };
  };

  const bankRow = (coopId: string, amount: number, ogmCode?: string) =>
    prisma.bankTransaction.create({ data: { coopId, date: new Date(), amount, ogmCode } });

  it('two concurrent €3 manual matches on a €6 card end with the card PAID and two payments', async () => {
    for (let round = 0; round < 5; round++) {
      const { coop, card } = await setup();
      const [first, second] = [await bankRow(coop.id, 3), await bankRow(coop.id, 3)];

      const results = await Promise.allSettled([
        bankImport.manualMatch(coop.id, first.id, { chargeCardId: card.id }, userId),
        bankImport.manualMatch(coop.id, second.id, { chargeCardId: card.id }, userId),
      ]);

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
      expect(after.status).toBe('PAID');
      expect(after.paidAt).not.toBeNull();
      expect(await prisma.payment.count({ where: { chargeCardId: card.id } })).toBe(2);
    }
  });

  it('a manual payment racing a cancel never leaves a payment on a CANCELLED card', async () => {
    for (let round = 0; round < 5; round++) {
      const { coop, card } = await setup();
      const row = await bankRow(coop.id, 6);

      const [payment, cancel] = await Promise.allSettled([
        bankImport.manualMatch(coop.id, row.id, { chargeCardId: card.id }, userId),
        transitionCard(prisma as any, { id: card.id }, { status: 'REQUESTED' }, { status: 'CANCELLED' }, 'cancel'),
      ]);

      const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
      const cardPayments = await prisma.payment.count({ where: { chargeCardId: card.id } });
      const bank = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } });
      if (after.status === 'CANCELLED') {
        expect(cancel.status).toBe('fulfilled');
        expect(payment.status).toBe('rejected');
        expect(cardPayments).toBe(0);
        expect(bank.matchStatus).toBe('UNMATCHED');
      } else {
        expect(after.status).toBe('PAID');
        expect(payment.status).toBe('fulfilled');
        expect(cancel.status).toBe('rejected');
        expect(cardPayments).toBe(1);
        expect(bank.matchStatus).toBe('MANUAL_MATCHED');
      }
    }
  });

  it('an auto-match racing a cancel never leaves a payment on a CANCELLED card', async () => {
    for (let round = 0; round < 5; round++) {
      const { coop, card } = await setup();
      const row = await bankRow(coop.id, 6, card.ogmCode);
      // The CSV import hands over a target read before the race.
      const target = await ogm.findChargeCardTarget(coop.id, card.id);
      const tx = { id: row.id, date: row.date, amount: 6, ogmCode: card.ogmCode };

      const [match, cancel] = await Promise.allSettled([
        matcher.matchTransaction(coop.id, tx, undefined, true, target!),
        transitionCard(prisma as any, { id: card.id }, { status: 'REQUESTED' }, { status: 'CANCELLED' }, 'cancel'),
      ]);

      expect(match.status).toBe('fulfilled');
      const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
      const cardPayments = await prisma.payment.count({ where: { chargeCardId: card.id } });
      const bank = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } });
      if (after.status === 'CANCELLED') {
        expect(cancel.status).toBe('fulfilled');
        expect((match as PromiseFulfilledResult<{ status: string }>).value.status).toBe('UNMATCHED');
        expect(cardPayments).toBe(0);
        expect(bank.matchStatus).toBe('UNMATCHED');
      } else {
        expect(after.status).toBe('PAID');
        expect(cancel.status).toBe('rejected');
        expect(cardPayments).toBe(1);
        expect(bank.matchStatus).toBe('AUTO_MATCHED');
      }
    }
  });

  it('a shareholder cannot cancel a card that already holds a partial payment', async () => {
    const { coop, card, shareholder, userId: owner } = await setupOwned();
    const row = await bankRow(coop.id, 3);
    await bankImport.manualMatch(coop.id, row.id, { chargeCardId: card.id }, userId);

    await expect(cards.cancel(shareholder.id, owner, card.id)).rejects.toBeInstanceOf(ConflictException);
    const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.status).toBe('REQUESTED');
  });

  it('a partial payment racing a shareholder cancel: exactly one wins, never a payment on a CANCELLED card', async () => {
    for (let round = 0; round < 5; round++) {
      const { coop, card, shareholder, userId: owner } = await setupOwned();
      const row = await bankRow(coop.id, 3);

      const [payment, cancel] = await Promise.allSettled([
        bankImport.manualMatch(coop.id, row.id, { chargeCardId: card.id }, userId),
        cards.cancel(shareholder.id, owner, card.id),
      ]);

      const after = await prisma.chargeCard.findUniqueOrThrow({ where: { id: card.id } });
      const cardPayments = await prisma.payment.count({ where: { chargeCardId: card.id } });
      const bank = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } });
      // Assert on the outcome. The loser's error depends on timing: a cancel that
      // commits before manualMatch's pre-check gives a 400, one that commits while
      // the payment waits for the card lock gives a 409.
      const refused = (result: PromiseSettledResult<unknown>) =>
        result.status === 'rejected' &&
        (result.reason instanceof ConflictException || result.reason instanceof BadRequestException);
      expect([payment.status, cancel.status].sort()).toEqual(['fulfilled', 'rejected']);
      if (after.status === 'CANCELLED') {
        expect(cancel.status).toBe('fulfilled');
        expect(refused(payment)).toBe(true);
        expect(cardPayments).toBe(0);
        expect(bank.matchStatus).toBe('UNMATCHED');
      } else {
        expect(after.status).toBe('REQUESTED');
        expect(payment.status).toBe('fulfilled');
        expect(refused(cancel)).toBe(true);
        expect(cardPayments).toBe(1);
        expect(bank.matchStatus).toBe('MANUAL_MATCHED');
      }
    }
  });

  it('a stale target for a card cancelled before the match stays UNMATCHED with no payment', async () => {
    const { coop, card } = await setup();
    const row = await bankRow(coop.id, 6, card.ogmCode);
    const stale = await ogm.findChargeCardTarget(coop.id, card.id);
    await prisma.chargeCard.update({ where: { id: card.id }, data: { status: 'CANCELLED' } });

    const result = await matcher.matchTransaction(
      coop.id,
      { id: row.id, date: row.date, amount: 6, ogmCode: card.ogmCode },
      undefined,
      true,
      stale!,
    );

    expect(result.status).toBe('UNMATCHED');
    expect(await prisma.payment.count({ where: { chargeCardId: card.id } })).toBe(0);
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: row.id } })).matchStatus).toBe('UNMATCHED');
  });
});
