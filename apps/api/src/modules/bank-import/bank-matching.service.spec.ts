jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { Prisma } from '@opencoop/database';
import { BankMatchingService } from './bank-matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { OgmService } from '../ogm/ogm.service';
import { ChargeCardTarget } from '../ogm/payment-target';
import { generateOgmCode } from '@opencoop/shared';

describe('BankMatchingService', () => {
  let service: BankMatchingService;
  let prisma: any;
  let paymentsService: any;
  let ogmService: OgmService;
  const OGM = generateOgmCode('001', 42);

  const bankTransaction = {
    id: 'bank-tx-1',
    date: new Date('2026-01-15'),
    amount: 100,
    referenceText: OGM,
    ogmCode: null,
  };

  beforeEach(async () => {
    prisma = {
      registration: { findFirst: jest.fn() },
      payment: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'pay-card' }),
      },
      bankTransaction: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      chargeCard: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };
    paymentsService = { addPayment: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BankMatchingService,
        OgmService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();
    service = moduleRef.get(BankMatchingService);
    ogmService = moduleRef.get(OgmService);
  });

  it('links the closest equal unlinked payment even when the registration is completed', async () => {
    prisma.registration.findFirst.mockResolvedValue({
      id: 'reg-1',
      coopId: 'coop-1',
      status: 'COMPLETED',
      ogmCode: OGM,
    });
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-far', amount: 100, bankDate: new Date('2026-01-01'), bankTransactionId: null },
      { id: 'pay-close', amount: 100, bankDate: new Date('2026-01-14'), bankTransactionId: null },
    ]);

    const result = await service.matchTransaction('coop-1', bankTransaction);

    expect(result).toEqual({ status: 'AUTO_MATCHED', linkedExisting: true, createdPayment: false });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-close', bankTransactionId: null },
      data: { bankTransactionId: 'bank-tx-1', matchedAt: expect.any(Date) },
    });
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'bank-tx-1', matchStatus: 'UNMATCHED' },
      data: { matchStatus: 'AUTO_MATCHED', ogmCode: OGM },
    });
    expect(paymentsService.addPayment).not.toHaveBeenCalled();
  });

  it('leaves a completed registration unmatched when the unlinked payment amount differs', async () => {
    prisma.registration.findFirst.mockResolvedValue({
      id: 'reg-1',
      coopId: 'coop-1',
      status: 'COMPLETED',
      ogmCode: OGM,
    });
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amount: 99.99, bankDate: new Date('2026-01-14'), bankTransactionId: null },
    ]);

    const result = await service.matchTransaction('coop-1', bankTransaction);

    expect(result).toEqual({ status: 'UNMATCHED', linkedExisting: false, createdPayment: false });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.updateMany).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.update).not.toHaveBeenCalled();
  });

  it('creates a payment for an open registration when no equal unlinked payment exists', async () => {
    prisma.registration.findFirst.mockResolvedValue({
      id: 'reg-1',
      coopId: 'coop-1',
      status: 'ACTIVE',
      ogmCode: OGM,
    });
    prisma.payment.findMany.mockResolvedValue([]);

    const result = await service.matchTransaction('coop-1', bankTransaction, 'user-1');

    expect(result).toEqual({ status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true });
    expect(paymentsService.addPayment).toHaveBeenCalledWith({
      registrationId: 'reg-1',
      coopId: 'coop-1',
      amount: 100,
      bankDate: bankTransaction.date,
      bankTransactionId: 'bank-tx-1',
      matchedByUserId: 'user-1',
    });
    expect(prisma.bankTransaction.update).toHaveBeenCalledWith({
      where: { id: 'bank-tx-1' },
      data: { matchStatus: 'AUTO_MATCHED', ogmCode: OGM },
    });
  });
  it('leaves the row unmatched when a concurrent linker claimed the payment first', async () => {
    prisma.registration.findFirst.mockResolvedValue({ id: 'reg-1', coopId: 'coop-1', status: 'COMPLETED', ogmCode: OGM });
    prisma.payment.findMany.mockResolvedValue([
      { id: 'pay-1', amount: 100, bankDate: new Date('2026-01-14'), bankTransactionId: null },
    ]);
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.matchTransaction('coop-1', bankTransaction);

    expect(result).toEqual({ status: 'UNMATCHED', linkedExisting: false, createdPayment: false });
    expect(paymentsService.addPayment).not.toHaveBeenCalled();
  });

  it('looks the OGM up through OgmService, within the coop', async () => {
    const resolve = jest.spyOn(ogmService, 'resolveOgmTarget');
    prisma.registration.findFirst.mockResolvedValue(null);

    const result = await service.matchTransaction('coop-1', bankTransaction);

    expect(result.status).toBe('UNMATCHED');
    expect(resolve).toHaveBeenCalledWith('coop-1', OGM);
  });

  describe('charge cards', () => {
    const cardRow = {
      id: 'card-1',
      coopId: 'coop-1',
      shareholderId: 'sh-1',
      status: 'REQUESTED',
      feeInclVat: new Prisma.Decimal('6.00'),
      ogmCode: OGM,
    };
    const cardTx = { ...bankTransaction, amount: 6 };

    beforeEach(() => {
      prisma.registration.findFirst.mockResolvedValue(null);
      prisma.chargeCard.findFirst.mockResolvedValue(cardRow);
      prisma.payment.findMany.mockResolvedValue([{ amount: 6 }]);
    });

    it('AUTO_MATCHES a payment of at least the fee and marks the card PAID', async () => {
      const result = await service.matchTransaction('coop-1', cardTx, 'user-1');

      expect(result).toEqual({ status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true });
      expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'bank-tx-1', matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'AUTO_MATCHED', ogmCode: OGM },
      });
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chargeCardId: 'card-1',
          coopId: 'coop-1',
          amount: 6,
          bankTransactionId: 'bank-tx-1',
          matchedByUserId: 'user-1',
        }),
      });
      expect(prisma.chargeCard.updateMany).toHaveBeenCalledWith({
        where: { id: 'card-1', status: 'REQUESTED' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(paymentsService.addPayment).not.toHaveBeenCalled();
    });

    it('leaves a short payment UNMATCHED', async () => {
      const result = await service.matchTransaction('coop-1', { ...cardTx, amount: 5 });

      expect(result.status).toBe('UNMATCHED');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.bankTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('leaves a payment for a CANCELLED card UNMATCHED', async () => {
      prisma.chargeCard.findFirst.mockResolvedValue({ ...cardRow, status: 'CANCELLED' });

      await expect(service.matchTransaction('coop-1', cardTx)).resolves.toMatchObject({ status: 'UNMATCHED' });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('books nothing when auto-match is off (Ponto with autoMatchPayments = false)', async () => {
      await expect(service.matchTransaction('coop-1', cardTx, undefined, false)).resolves.toMatchObject({
        status: 'UNMATCHED',
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('second transfer for a paid card stays UNMATCHED', async () => {
      // The CSV import hands the same cached target to every row of the file.
      const cached: ChargeCardTarget = {
        kind: 'chargeCard',
        id: 'card-1',
        coopId: 'coop-1',
        shareholderId: 'sh-1',
        status: 'REQUESTED',
        feeInclVat: 6,
        ogmCode: OGM,
      };

      const first = await service.matchTransaction('coop-1', cardTx, 'user-1', true, cached);
      const second = await service.matchTransaction('coop-1', { ...cardTx, id: 'bank-tx-2' }, 'user-1', true, cached);

      expect(first.status).toBe('AUTO_MATCHED');
      expect(second.status).toBe('UNMATCHED');
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
      expect(cached.status).toBe('PAID');
    });
  });
});
