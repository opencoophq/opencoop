jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { generateOgmCode } from '@opencoop/shared';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { PaymentsService } from '../payments/payments.service';

describe('bank reconciliation regressions', () => {
  let service: BankImportService;
  let prisma: any;
  let paymentsService: any;
  const coopId = 'coop-1';
  const userId = 'user-1';
  const ogm = generateOgmCode('001', 42);
  const rawOgm = ogm.replace(/[+/]/g, '');

  const csv = (date: string, amount: string, reference: string) =>
    Buffer.from(
      ['date;amount;counterparty;reference', `${date};${amount};Alice;${reference}`].join('\n'),
      'utf8',
    );

  beforeEach(async () => {
    const registrations = new Map<string, any>();
    prisma = {
      bankImport: {
        create: jest.fn().mockResolvedValue({ id: 'import-1' }),
        update: jest.fn().mockResolvedValue({ id: 'import-1' }),
      },
      bankTransaction: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: `bank-${Date.now()}-${Math.random()}`, ...data })),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const transaction = bankRows.find((row: any) => row.id === where.id);
          if (transaction) Object.assign(transaction, data);
          return transaction || {};
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          for (const transaction of bankRows) {
            const idMatches = typeof where.id === 'string' ? where.id === transaction.id : where.id.in.includes(transaction.id);
            if (idMatches && transaction.matchStatus === where.matchStatus) {
              Object.assign(transaction, data);
              count++;
            }
          }
          return { count };
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'payment-created' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const payment = payments.find((candidate: any) => candidate.id === where.id);
          if (payment) Object.assign(payment, data);
          return payment || {};
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          const payment = payments.find(
            (candidate: any) =>
              candidate.id === where.id && (where.bankTransactionId !== null || candidate.bankTransactionId === null),
          );
          if (!payment) return { count: 0 };
          Object.assign(payment, data);
          return { count: 1 };
        }),
      },
      registration: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          where.ogmCode
            ? registrations.get(where.ogmCode) || null
            : [...registrations.values()].find((registration) => registration.id === where.id) || null,
        ),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };
    const payments: any[] = [];
    const bankRows: any[] = [];
    prisma.__registrations = registrations;
    prisma.__payments = payments;
    prisma.__bankRows = bankRows;
    // Like Postgres, a transaction that throws leaves no trace: restore the rows it touched.
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const snapshot = [...payments, ...bankRows].map((row) => [row, { ...row }] as const);
      try {
        return await callback(prisma);
      } catch (error) {
        for (const [row, saved] of snapshot) {
          for (const key of Object.keys(row)) delete row[key];
          Object.assign(row, saved);
        }
        throw error;
      }
    });
    prisma.bankTransaction.create.mockImplementation(({ data }: any) => {
      const row = { id: `bank-${bankRows.length + 1}`, ...data };
      bankRows.push(row);
      return row;
    });
    prisma.bankTransaction.findMany.mockImplementation(({ where }: any) =>
      bankRows.filter((row) =>
        row.coopId === where.coopId &&
        (!where.matchStatus || row.matchStatus === where.matchStatus) &&
        (!where.id?.in || where.id.in.includes(row.id)),
      ),
    );
    prisma.payment.findMany.mockImplementation(({ where }: any) =>
      payments.filter((payment) =>
        payment.registrationId === where.registrationId &&
        (where.bankTransactionId === undefined || payment.bankTransactionId === where.bankTransactionId),
      ),
    );
    prisma.payment.findFirst.mockImplementation(({ where }: any) =>
      payments.find((payment) => payment.id === where.id && payment.coopId === where.coopId) || null,
    );
    prisma.payment.create.mockImplementation(({ data }: any) => {
      const payment = { id: `payment-${payments.length + 1}`, ...data };
      payments.push(payment);
      return payment;
    });
    paymentsService = {
      addPayment: jest.fn().mockImplementation(async (data) => {
        const payment = await prisma.payment.create({ data: { ...data, matchedAt: new Date() } });
        return payment;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BankImportService,
        BankMatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: RegistrationsService, useValue: { onRegistrationCompleted: jest.fn() } },
        { provide: ShareholderStatusService, useValue: { recompute: jest.fn(), recomputeMany: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(BankImportService);
  });

  const addRegistration = (status: string, registrationId = 'reg-1') => {
    const registration = {
      id: registrationId,
      coopId,
      ogmCode: ogm,
      status,
      totalAmount: 100,
      shareholderId: 'shareholder-1',
    };
    prisma.__registrations.set(ogm, registration);
    return registration;
  };

  const addPayment = (data: Partial<any> = {}) => {
    const payment = {
      id: `existing-${prisma.__payments.length + 1}`,
      registrationId: 'reg-1',
      coopId,
      amount: 100,
      bankDate: new Date('2026-01-14'),
      bankTransactionId: null,
      ...data,
    };
    prisma.__payments.push(payment);
    return payment;
  };

  it('CSV links an equal unlinked payment on a completed registration without creating one', async () => {
    addRegistration('COMPLETED');
    const payment = addPayment();

    await service.importCsv(coopId, userId, 'payments.csv', csv('2026-01-15', '100.00', ogm));

    expect(payment.bankTransactionId).toBe('bank-1');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.__bankRows[0].matchStatus).toBe('AUTO_MATCHED');
  });

  it('CSV leaves a completed registration unmatched when the unlinked amount differs', async () => {
    addRegistration('COMPLETED');
    addPayment({ amount: 99.99 });

    await service.importCsv(coopId, userId, 'payments.csv', csv('2026-01-15', '100.00', ogm));

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchedCount: 0, unmatchedCount: 1 }) }),
    );
  });

  it('CSV links the equal payment closest to the transaction date', async () => {
    addRegistration('COMPLETED');
    const far = addPayment({ id: 'far', bankDate: new Date('2026-01-01') });
    const close = addPayment({ id: 'close', bankDate: new Date('2026-01-14') });

    await service.importCsv(coopId, userId, 'payments.csv', csv('2026-01-15', '100.00', ogm));

    expect(close.bankTransactionId).toBe('bank-1');
    expect(far.bankTransactionId).toBeNull();
  });

  it('CSV keeps creating a payment for an open registration without an equal unlinked payment', async () => {
    addRegistration('PENDING_PAYMENT');

    await service.importCsv(coopId, userId, 'payments.csv', csv('2026-01-15', '100.00', ogm));

    expect(paymentsService.addPayment).toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: 'reg-1', amount: 100, bankTransactionId: 'bank-1' }),
    );
  });

  it('stores negative CSV rows as ignored without creating a payment', async () => {
    await service.importCsv(coopId, userId, 'payments.csv', csv('2026-01-15', '-20.00', 'supplier invoice'));

    expect(prisma.__bankRows[0].matchStatus).toBe('IGNORED');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rematches raw Ponto OGMs and reference-text OGMs, then becomes a no-op', async () => {
    addRegistration('COMPLETED', 'reg-raw');
    const secondOgm = generateOgmCode('001', 43);
    prisma.__registrations.set(secondOgm, { ...prisma.__registrations.get(ogm), id: 'reg-reference', ogmCode: secondOgm });
    const firstPayment = addPayment({ id: 'pay-raw', registrationId: 'reg-raw' });
    const secondPayment = addPayment({ id: 'pay-reference', registrationId: 'reg-reference' });
    prisma.__bankRows.push(
      { id: 'bank-raw', coopId, date: new Date('2026-01-15'), amount: 100, ogmCode: rawOgm, referenceText: null, matchStatus: 'UNMATCHED' },
      { id: 'bank-reference', coopId, date: new Date('2026-01-15'), amount: 100, ogmCode: null, referenceText: secondOgm, matchStatus: 'UNMATCHED' },
    );

    const first = await service.rematch(coopId, userId);
    const second = await service.rematch(coopId, userId);

    expect(first).toMatchObject({ checked: 2, linkedExisting: 2, createdPayments: 0, stillUnmatched: 0, ignoredOutgoing: 0 });
    expect(firstPayment.bankTransactionId).toBe('bank-raw');
    expect(secondPayment.bankTransactionId).toBe('bank-reference');
    expect(second).toEqual({ checked: 0, linkedExisting: 0, createdPayments: 0, stillUnmatched: 0, ignoredOutgoing: 0 });
  });

  it('manual payment matching enforces coop, link state, and exact cents', async () => {
    const payment = addPayment({ id: 'payment-1' });
    const bankRow = { id: 'bank-1', coopId, matchStatus: 'UNMATCHED', amount: 100, date: new Date() };
    prisma.__bankRows.push(bankRow);
    prisma.bankTransaction.findFirst.mockResolvedValue({ ...bankRow });

    await service.manualMatch(coopId, 'bank-1', { paymentId: payment.id }, userId);
    expect(payment.bankTransactionId).toBe('bank-1');
    expect(bankRow.matchStatus).toBe('MANUAL_MATCHED');

    prisma.payment.findFirst.mockReturnValue(null);
    await expect(service.manualMatch(coopId, 'bank-1', { paymentId: 'foreign' }, userId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('manual payment matching returns 409 when the payment was linked concurrently', async () => {
    const payment = addPayment({ id: 'payment-race' });
    prisma.__bankRows.push({ id: 'bank-1', coopId, matchStatus: 'UNMATCHED', amount: 100, date: new Date() });
    prisma.bankTransaction.findFirst.mockResolvedValue({ id: 'bank-1', coopId, matchStatus: 'UNMATCHED', amount: 100, date: new Date() });
    // The read still sees the payment as free; another linker claims it before the update runs.
    prisma.payment.findFirst.mockResolvedValueOnce({ ...payment });
    (payment as { bankTransactionId: string | null }).bankTransactionId = 'bank-other';

    await expect(service.manualMatch(coopId, 'bank-1', { paymentId: payment.id }, userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(payment.bankTransactionId).toBe('bank-other');
    expect(prisma.__bankRows.find((row: any) => row.id === 'bank-1').matchStatus).toBe('UNMATCHED');
  });

  it('manual payment matching rejects a linked payment and a cent mismatch', async () => {
    const linked = addPayment({ id: 'linked', bankTransactionId: 'other-bank' });
    const mismatched = addPayment({ id: 'mismatched', amount: 99.99 });
    prisma.bankTransaction.findFirst.mockResolvedValue({ id: 'bank-1', coopId, matchStatus: 'UNMATCHED', amount: 100, date: new Date() });

    await expect(service.manualMatch(coopId, 'bank-1', { paymentId: linked.id }, userId)).rejects.toThrow(
      'already matched',
    );
    await expect(service.manualMatch(coopId, 'bank-1', { paymentId: mismatched.id }, userId)).rejects.toThrow(
      'exactly match',
    );
  });

  it('manual registration matching rejects completed registrations without creating a payment', async () => {
    addRegistration('COMPLETED');
    prisma.bankTransaction.findFirst.mockResolvedValue({ id: 'bank-1', coopId, matchStatus: 'UNMATCHED', amount: 100, date: new Date() });

    await expect(service.manualMatch(coopId, 'bank-1', { registrationId: 'reg-1' }, userId)).rejects.toThrow(
      'already fully paid',
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('ignore and unignore only change rows in the requested status', async () => {
    prisma.__bankRows.push(
      { id: 'unmatched', coopId, matchStatus: 'UNMATCHED' },
      { id: 'matched', coopId, matchStatus: 'AUTO_MATCHED' },
      { id: 'ignored', coopId, matchStatus: 'IGNORED' },
    );

    await expect(service.ignoreTransactions(coopId, ['unmatched', 'matched'])).resolves.toEqual({ ignored: 1, skipped: 1 });
    await expect(service.unignoreTransactions(coopId, ['ignored'])).resolves.toEqual({ unignored: 1, skipped: 0 });
    expect(prisma.__bankRows.find((row: any) => row.id === 'matched').matchStatus).toBe('AUTO_MATCHED');
  });

  it('rematch ignores old negative rows and never reprocesses ignored positive rows', async () => {
    prisma.__bankRows.push(
      { id: 'old-outgoing', coopId, amount: -10, matchStatus: 'UNMATCHED' },
      { id: 'ignored-incoming', coopId, amount: 100, matchStatus: 'IGNORED' },
    );

    const result = await service.rematch(coopId, userId);

    expect(result).toEqual({ checked: 0, linkedExisting: 0, createdPayments: 0, stillUnmatched: 0, ignoredOutgoing: 1 });
    expect(prisma.__bankRows.find((row: any) => row.id === 'old-outgoing').matchStatus).toBe('IGNORED');
    expect(prisma.__bankRows.find((row: any) => row.id === 'ignored-incoming').matchStatus).toBe('IGNORED');
  });
});
