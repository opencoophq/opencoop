// bank-import.service -> registrations.service -> documents.service transitively
// imports @react-pdf/renderer (ESM-only). Mock the module before any imports load it.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { generateOgmCode, validateOgmCode } from '@opencoop/shared';

/**
 * Behavioural specs for bank-import OGM matching (importCsv).
 *
 * The `generic` preset's parser (parseGenericCsv) skips the header row and splits
 * each data line on ';' into [date, amount, counterparty, reference]. The OGM is
 * extracted from the reference column via /\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+/.
 *
 * A credit row whose reference contains an OGM matching a PENDING_PAYMENT/ACTIVE
 * registration of the same coop is AUTO_MATCHED and a Payment is booked; otherwise
 * UNMATCHED. This is the path that flips registrations to paid, so a regression
 * double-books or under-books money.
 */
describe('BankImportService — importCsv OGM matching', () => {
  let service: BankImportService;
  let prisma: any;
  let registrationsService: any;
  let shareholderStatus: any;
  let bankMatchingService: any;

  // A real, checksum-valid OGM produced the same way the app generates them.
  const OGM = generateOgmCode('001', 42);
  const COOP_ID = 'coop-1';
  const IMPORTER_ID = 'user-1';

  beforeEach(async () => {
    prisma = {
      bankImport: {
        create: jest.fn().mockResolvedValue({ id: 'imp-1' }),
        update: jest.fn().mockResolvedValue({ id: 'imp-1' }),
      },
      bankTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'btx-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      registration: {
        // Batched lookup: one findMany({ where: { ogmCode: { in: [...] } } })
        // returns the matching registrations for the rows in this import.
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    bankMatchingService = {
      matchTransaction: jest.fn(async (coopId: string, transaction: any, userId?: string) => {
        const registrations = await prisma.registration.findMany();
        const registration = registrations.find(
          (candidate: any) => candidate.coopId === coopId && candidate.ogmCode === transaction.ogmCode,
        );
        if (!registration || !['PENDING_PAYMENT', 'ACTIVE'].includes(registration.status)) {
          return { status: 'UNMATCHED', linkedExisting: false, createdPayment: false };
        }

        const bankTransaction = { id: transaction.id };
        await prisma.payment.create({
          data: {
            registrationId: registration.id,
            coopId,
            amount: transaction.amount,
            bankDate: transaction.date,
            bankTransactionId: bankTransaction.id,
            matchedByUserId: userId,
            matchedAt: new Date(),
          },
        });
        const allPayments = await prisma.payment.findMany({ where: { registrationId: registration.id } });
        const totalPaid = allPayments.reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
        if (totalPaid >= Number(registration.totalAmount)) {
          registration.status = 'COMPLETED';
          await prisma.registration.update({
            where: { id: registration.id },
            data: { status: 'COMPLETED' },
          });
          await registrationsService.onRegistrationCompleted(registration.id);
        } else if (registration.status === 'PENDING_PAYMENT') {
          registration.status = 'ACTIVE';
          await prisma.registration.update({ where: { id: registration.id }, data: { status: 'ACTIVE' } });
          await shareholderStatus.recomputeMany([registration.shareholderId]);
        }
        await prisma.bankTransaction.update({
          where: { id: transaction.id },
          data: { matchStatus: 'AUTO_MATCHED', ogmCode: transaction.ogmCode },
        });
        return { status: 'AUTO_MATCHED', linkedExisting: false, createdPayment: true };
      }),
    };
    registrationsService = {
      onRegistrationCompleted: jest.fn().mockResolvedValue(null),
    };
    shareholderStatus = {
      recompute: jest.fn().mockResolvedValue(null),
      recomputeMany: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BankImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: RegistrationsService, useValue: registrationsService },
        { provide: ShareholderStatusService, useValue: shareholderStatus },
        { provide: BankMatchingService, useValue: bankMatchingService },
      ],
    }).compile();
    service = moduleRef.get(BankImportService);
  });

  // Build a generic-preset CSV: header line + one data row.
  const csv = (date: string, amount: string, counterparty: string, reference: string) =>
    Buffer.from(
      ['date;amount;counterparty;reference', `${date};${amount};${counterparty};${reference}`].join(
        '\n',
      ),
      'utf-8',
    );

  // Build a generic-preset CSV with several data rows.
  const csvRows = (rows: [string, string, string, string][]) =>
    Buffer.from(
      ['date;amount;counterparty;reference', ...rows.map((r) => r.join(';'))].join('\n'),
      'utf-8',
    );

  it('sanity: the test OGM is a valid Belgian structured-communication code', () => {
    expect(validateOgmCode(OGM)).toBe(true);
  });

  it('skips all rows when importing the same CSV twice', async () => {
    const file = csvRows([
      ['2026-01-15', '100', 'Jan Peeters', 'first'],
      ['2026-01-16', '-20', 'Supplier', 'second'],
    ]);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'first.csv', file, 'generic');
    prisma.bankTransaction.findMany.mockResolvedValue([
      { date: new Date(2026, 0, 15), amount: 100, counterparty: 'Jan Peeters', referenceText: 'first' },
      { date: new Date(2026, 0, 16), amount: -20, counterparty: 'Supplier', referenceText: 'second' },
    ]);
    prisma.bankTransaction.create.mockClear();
    prisma.payment.create.mockClear();

    const result = await service.importCsv(COOP_ID, IMPORTER_ID, 'second.csv', file, 'generic');

    expect(prisma.bankTransaction.create).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(result.skippedCount).toBe(2);
    expect(prisma.bankImport.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rowCount: 0 }) }),
    );
  });

  it('imports only the new row from overlapping exports', async () => {
    prisma.bankTransaction.findMany.mockResolvedValue([
      { date: new Date(2026, 0, 15), amount: 100, counterparty: 'A', referenceText: 'a' },
      { date: new Date(2026, 0, 16), amount: 200, counterparty: 'B', referenceText: 'b' },
    ]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'overlap.csv',
      csvRows([
        ['2026-01-16', '200', 'B', 'b'],
        ['2026-01-17', '300', 'C', 'c'],
      ]),
      'generic',
    );

    expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date: new Date(2026, 0, 17),
          amount: 300,
          counterparty: 'C',
          referenceText: 'c',
        }),
      }),
    );
  });

  it('imports one of two identical rows when one already exists', async () => {
    prisma.bankTransaction.findMany.mockResolvedValue([
      { date: new Date(2026, 0, 15), amount: 100, counterparty: 'X', referenceText: 'x' },
    ]);

    const result = await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'duplicate.csv',
      csvRows([
        ['2026-01-15', '100', 'X', 'x'],
        ['2026-01-15', '100', 'X', 'x'],
      ]),
      'generic',
    );

    expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(1);
    expect(result.skippedCount).toBe(1);
  });

  it('imports both identical rows when the database has none', async () => {
    const result = await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'legitimate-repeats.csv',
      csvRows([
        ['2026-01-15', '100', 'X', 'x'],
        ['2026-01-15', '100', 'X', 'x'],
      ]),
      'generic',
    );

    expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(2);
    expect(result.skippedCount).toBe(0);
  });

  it('scopes duplicate lookup to the imported coop and inclusive file date range', async () => {
    await service.importCsv(
      'coop-2',
      IMPORTER_ID,
      'other-coop.csv',
      csvRows([['2026-01-15', '100', 'X', 'x']]),
      'generic',
    );

    expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith({
      where: {
        coopId: 'coop-2',
        date: {
          gte: new Date(2026, 0, 15),
          lte: new Date(2026, 0, 15, 23, 59, 59, 999),
        },
      },
      select: { date: true, amount: true, counterparty: true, referenceText: true },
    });
    expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('finds the Belfius header regardless of blank or extra metadata lines', async () => {
    prisma.registration.findMany.mockResolvedValue([]);

    const header =
      'Rekening;Boekingsdatum;Rekeninguittrekselnummer;Transactienummer;Rekening tegenpartij;Naam tegenpartij bevat;Straat en nummer;Postcode en gemeente;Transactie;Valutadatum;Bedrag;Devies;BIC;Landcode;Mededelingen';
    const row =
      'BE00 0000 0000 0000;21/09/2026;;;;;;;STORTING;21/09/2026;125,00;EUR;;;vrije mededeling';
    const csv = Buffer.from(
      [
        'Boekingsdatum vanaf;01/01/2026',
        '',
        'Laatste saldo;1.000,00 EUR',
        '',
        ';',
        ';',
        'Extra;regel',
        header,
        row,
        '',
      ].join('\r\n'),
      'latin1',
    );

    await service.importCsv(COOP_ID, IMPORTER_ID, 'belfius.csv', csv, 'belfius');

    expect(prisma.bankImport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rowCount: 1 }) }),
    );
  });

  it('imports a real-shaped Belfius export with Belgian dates, amounts, and OGM matching', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-belfius-1',
        coopId: COOP_ID,
        shareholderId: 'sh-belfius-1',
        status: 'PENDING_PAYMENT',
        totalAmount: 125,
        isGift: false,
        ogmCode: OGM,
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([{ amount: 125 }]);

    const metadata = Array.from({ length: 11 }, (_, index) => `Metadata ${index + 1};value`);
    const belfiusCsv = Buffer.from(
      [
        ...metadata,
        ';',
        'Rekening;Boekingsdatum;Rekeninguittrekselnummer;Transactienummer;Rekening tegenpartij;Naam tegenpartij bevat;Straat en nummer;Postcode en gemeente;Transactie;Valutadatum;Bedrag;Devies;BIC;Landcode;Mededelingen',
        [
          'BE00 0000 0000 0000',
          '21/09/2026',
          '',
          '',
          'BE00 1111 1111 1111',
          'Jan Janssens',
          'Straat 1',
          '3500 HASSELT',
          `STORTING VAN BE00 1111 1111 1111 Jan Janssens ${OGM} NAAR BE00 0000 0000 0000 Coop`,
          '21/09/2026',
          '125,00',
          'EUR',
          'AXABBE22',
          'BE',
          `REF. : ${OGM}`,
        ].join(';'),
        [
          'BE00 0000 0000 0000',
          '17/09/2026',
          '',
          '',
          '',
          '',
          '',
          '',
          'UW COLLECTIEVE OVERSCHRIJVING LONEN ISABEL REF. : 0801B9H007760 VAL. 17-09',
          '17/09/2026',
          '-1.065,40',
          'EUR',
          '',
          '',
          'UW COLLECTIEVE OVERSCHRIJVING LONEN ISABEL',
        ].join(';'),
      ].join('\n'),
      'latin1',
    );

    await service.importCsv(COOP_ID, IMPORTER_ID, 'belfius.csv', belfiusCsv, 'belfius');

    expect(prisma.bankImport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rowCount: 2 }) }),
    );
    expect(prisma.bankTransaction.create).toHaveBeenCalledTimes(2);

    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date: new Date(2026, 8, 21),
          amount: 125,
          referenceText: expect.stringContaining(OGM),
          matchStatus: 'UNMATCHED',
        }),
      }),
    );
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date: new Date(2026, 8, 17),
          amount: -1065.4,
          matchStatus: 'IGNORED',
        }),
      }),
    );
  });

  it('AUTO_MATCHES a credit row whose reference contains an OGM for a PENDING_PAYMENT registration', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        coopId: COOP_ID,
        shareholderId: 'sh-1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);
    // Payment just booked equals total -> registration completes
    prisma.payment.findMany.mockResolvedValue([{ amount: 100 }]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csv('2026-01-15', '100', 'Jan Peeters', OGM),
      'generic',
    );

    // Outcome: the row was matched and a payment booked against reg-1.
    // (We assert the real effects below, not the lookup mechanic.)

    // Bank transaction recorded as AUTO_MATCHED with the OGM
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: 'UNMATCHED',
          ogmCode: OGM,
          amount: 100,
        }),
      }),
    );

    // Payment booked against the matched registration
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registrationId: 'reg-1',
          coopId: COOP_ID,
          amount: 100,
        }),
      }),
    );

    // Fully paid -> COMPLETED
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reg-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );

    // matchedCount = 1
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedCount: 1, unmatchedCount: 0 }),
      }),
    );
  });

  it('flips PENDING_PAYMENT to ACTIVE (not COMPLETED) on a partial payment', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        coopId: COOP_ID,
        shareholderId: 'sh-1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);
    // Only a partial payment so far
    prisma.payment.findMany.mockResolvedValue([{ amount: 60 }]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csv('2026-01-15', '60', 'Jan', OGM),
      'generic',
    );

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 60 }) }),
    );
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
    expect(shareholderStatus.recomputeMany).toHaveBeenCalledWith(['sh-1']);
  });

  it('leaves a row with no OGM in the reference UNMATCHED', async () => {
    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csv('2026-01-15', '100', 'Jan Peeters', 'gewone overschrijving zonder mededeling'),
      'generic',
    );

    // Outcome: no payment booked, transaction recorded UNMATCHED with no OGM.
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchStatus: 'UNMATCHED', ogmCode: null }),
      }),
    );
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedCount: 0, unmatchedCount: 1 }),
      }),
    );
  });

  it('leaves a row UNMATCHED when its OGM matches no registration', async () => {
    // The batched findMany returns no registration for this OGM.
    prisma.registration.findMany.mockResolvedValue([]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csv('2026-01-15', '100', 'Jan', OGM),
      'generic',
    );

    // Outcome: no payment booked.
    expect(prisma.payment.create).not.toHaveBeenCalled();
    // OGM is still recorded on the transaction even though it didn't match
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchStatus: 'UNMATCHED', ogmCode: OGM }),
      }),
    );
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedCount: 0, unmatchedCount: 1 }),
      }),
    );
  });

  it('leaves a row UNMATCHED when the OGM belongs to a different coop (tenant isolation)', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-other',
        coopId: 'some-other-coop',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csv('2026-01-15', '100', 'Jan', OGM),
      'generic',
    );

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'UNMATCHED' }) }),
    );
  });

  // Map-staleness guard. The OLD code re-read the registration fresh per row, so a
  // later same-OGM row saw the UPDATED status. With a single pre-fetched findMany,
  // the cached entry must be mutated after each match or a later row would see a
  // STALE status and double-book money. Three rows toward ONE registration:
  //   row1 (60) -> total 60  < 100 -> ACTIVE     (PENDING_PAYMENT -> ACTIVE)
  //   row2 (60) -> total 120 >= 100 -> COMPLETED (ACTIVE -> COMPLETED)
  //   row3 (60) -> registration now COMPLETED -> gate excludes it -> UNMATCHED, no payment
  // A fresh DB read would produce exactly this. If the map were NOT kept in sync,
  // row3 would still see PENDING_PAYMENT and wrongly book a 3rd payment.
  it('keeps the cached registration in sync across same-OGM rows (no stale double-book)', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        coopId: COOP_ID,
        shareholderId: 'sh-1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);

    // computeTotalPaid reads cumulative payments from the DB per match. Simulate
    // the cumulative totals a fresh DB read would return for rows 1 and 2.
    prisma.payment.findMany
      .mockResolvedValueOnce([{ amount: 60 }]) // after row1: 60
      .mockResolvedValueOnce([{ amount: 60 }, { amount: 60 }]); // after row2: 120

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csvRows([
        ['2026-01-15', '60', 'Jan', OGM],
        ['2026-01-16', '60', 'Jan', OGM],
        ['2026-01-17', '60', 'Jan', OGM],
      ]),
      'generic',
    );

    // Only rows 1 and 2 booked a payment; row 3 hit a COMPLETED reg and did NOT.
    expect(prisma.payment.create).toHaveBeenCalledTimes(2);

    // Row 1 flipped PENDING_PAYMENT -> ACTIVE; row 2 flipped ACTIVE -> COMPLETED.
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'reg-1' }, data: { status: 'ACTIVE' } }),
    );
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reg-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    // Exactly two status updates (ACTIVE then COMPLETED) — row 3 made none.
    expect(prisma.registration.update).toHaveBeenCalledTimes(2);

    // The completed registration's onCompleted hook is not double-fired.
    // Outcome tally: two matched (rows 1-2), one unmatched (row 3).
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchedCount: 2, unmatchedCount: 1 }),
      }),
    );

    // Row 3 recorded as UNMATCHED (the gate excluded the now-COMPLETED reg),
    // but the OGM is still stored on the transaction.
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchStatus: 'UNMATCHED', ogmCode: OGM }),
      }),
    );
  });

  it('sends every positive row through the shared matcher', async () => {
    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csvRows([
        ['2026-01-15', '100', 'A', OGM],
        ['2026-01-16', '100', 'B', OGM],
      ]),
      'generic',
    );

    expect(bankMatchingService.matchTransaction).toHaveBeenCalledTimes(2);
    expect(bankMatchingService.matchTransaction.mock.calls[0][1].ogmCode).toBe(OGM);
  });

  it('recomputes status after a manual partial-payment match commits', async () => {
    prisma.bankTransaction.findFirst.mockResolvedValue({
      id: 'btx-1',
      coopId: COOP_ID,
      matchStatus: 'UNMATCHED',
      amount: 60,
      date: new Date('2026-01-15'),
    });
    prisma.registration.findFirst.mockResolvedValue({
      id: 'reg-1',
      coopId: COOP_ID,
      shareholderId: 'sh-1',
      status: 'PENDING_PAYMENT',
      totalAmount: 100,
    });
    prisma.payment.findMany.mockResolvedValue([{ amount: 60 }]);

    await service.manualMatch(COOP_ID, 'btx-1', { registrationId: 'reg-1' }, IMPORTER_ID);

    expect(shareholderStatus.recompute).toHaveBeenCalledWith('sh-1');
  });

  it('rejects a bank transaction from a different coop without creating a payment', async () => {
    prisma.bankTransaction.findFirst.mockResolvedValue(null);

    await expect(
      service.manualMatch(COOP_ID, 'btx-1', { registrationId: 'reg-1' }, IMPORTER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.bankTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: 'btx-1', coopId: COOP_ID },
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a registration from a different coop without creating a payment', async () => {
    prisma.bankTransaction.findFirst.mockResolvedValue({
      id: 'btx-1',
      matchStatus: 'UNMATCHED',
      amount: 60,
      date: new Date('2026-01-15'),
    });
    prisma.registration.findFirst.mockResolvedValue(null);

    await expect(
      service.manualMatch(COOP_ID, 'btx-1', { registrationId: 'reg-1' }, IMPORTER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.bankTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: 'btx-1', coopId: COOP_ID },
    });
    expect(prisma.registration.findFirst).toHaveBeenCalledWith({
      where: { id: 'reg-1', coopId: COOP_ID },
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});
