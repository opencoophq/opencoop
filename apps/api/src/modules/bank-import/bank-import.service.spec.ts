// bank-import.service -> registrations.service -> documents.service transitively
// imports @react-pdf/renderer (ESM-only). Mock the module before any imports load it.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { BankImportService } from './bank-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
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
      },
      payment: {
        create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      registration: {
        // Batched lookup: one findMany({ where: { ogmCode: { in: [...] } } })
        // returns the matching registrations for the rows in this import.
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    registrationsService = {
      onRegistrationCompleted: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BankImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: RegistrationsService, useValue: registrationsService },
      ],
    }).compile();
    service = moduleRef.get(BankImportService);
  });

  // Build a generic-preset CSV: header line + one data row.
  const csv = (date: string, amount: string, counterparty: string, reference: string) =>
    Buffer.from(
      ['date;amount;counterparty;reference', `${date};${amount};${counterparty};${reference}`].join('\n'),
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

  it('AUTO_MATCHES a credit row whose reference contains an OGM for a PENDING_PAYMENT registration', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        coopId: COOP_ID,
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);
    // Payment just booked equals total -> registration completes
    prisma.payment.findMany.mockResolvedValue([{ amount: 100 }]);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan Peeters', OGM), 'generic');

    // Outcome: the row was matched and a payment booked against reg-1.
    // (We assert the real effects below, not the lookup mechanic.)

    // Bank transaction recorded as AUTO_MATCHED with the OGM
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: 'AUTO_MATCHED',
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
      expect.objectContaining({ data: expect.objectContaining({ matchedCount: 1, unmatchedCount: 0 }) }),
    );
  });

  it('flips PENDING_PAYMENT to ACTIVE (not COMPLETED) on a partial payment', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        coopId: COOP_ID,
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        isGift: false,
        ogmCode: OGM,
      },
    ]);
    // Only a partial payment so far
    prisma.payment.findMany.mockResolvedValue([{ amount: 60 }]);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '60', 'Jan', OGM), 'generic');

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 60 }) }),
    );
    expect(prisma.registration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
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
      expect.objectContaining({ data: expect.objectContaining({ matchedCount: 0, unmatchedCount: 1 }) }),
    );
  });

  it('leaves a row UNMATCHED when its OGM matches no registration', async () => {
    // The batched findMany returns no registration for this OGM.
    prisma.registration.findMany.mockResolvedValue([]);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan', OGM), 'generic');

    // Outcome: no payment booked.
    expect(prisma.payment.create).not.toHaveBeenCalled();
    // OGM is still recorded on the transaction even though it didn't match
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchStatus: 'UNMATCHED', ogmCode: OGM }),
      }),
    );
    expect(prisma.bankImport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchedCount: 0, unmatchedCount: 1 }) }),
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

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan', OGM), 'generic');

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

  it('issues ONE batched findMany for all OGMs (no per-row N+1 lookup)', async () => {
    const OGM2 = generateOgmCode('002', 7);
    prisma.registration.findMany.mockResolvedValue([]);

    await service.importCsv(
      COOP_ID,
      IMPORTER_ID,
      'test.csv',
      csvRows([
        ['2026-01-15', '100', 'A', OGM],
        ['2026-01-16', '100', 'B', OGM2],
        ['2026-01-17', '100', 'C', OGM], // duplicate OGM -> deduped
      ]),
      'generic',
    );

    expect(prisma.registration.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.registration.findMany.mock.calls[0][0];
    expect(arg.where.ogmCode.in).toEqual(expect.arrayContaining([OGM, OGM2]));
    // Deduped: two unique OGMs, not three.
    expect(arg.where.ogmCode.in).toHaveLength(2);
  });
});
