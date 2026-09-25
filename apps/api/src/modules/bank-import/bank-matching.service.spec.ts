jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { BankMatchingService } from './bank-matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { generateOgmCode } from '@opencoop/shared';

describe('BankMatchingService', () => {
  let service: BankMatchingService;
  let prisma: any;
  let paymentsService: any;
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
      payment: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bankTransaction: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };
    paymentsService = { addPayment: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BankMatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();
    service = moduleRef.get(BankMatchingService);
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
});
