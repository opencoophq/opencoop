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
        findUnique: jest.fn().mockResolvedValue(null),
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

  it('sanity: the test OGM is a valid Belgian structured-communication code', () => {
    expect(validateOgmCode(OGM)).toBe(true);
  });

  it('AUTO_MATCHES a credit row whose reference contains an OGM for a PENDING_PAYMENT registration', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      id: 'reg-1',
      coopId: COOP_ID,
      status: 'PENDING_PAYMENT',
      totalAmount: 100,
      isGift: false,
    });
    // Payment just booked equals total -> registration completes
    prisma.payment.findMany.mockResolvedValue([{ amount: 100 }]);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan Peeters', OGM), 'generic');

    // Looked up by the extracted OGM
    expect(prisma.registration.findUnique).toHaveBeenCalledWith({ where: { ogmCode: OGM } });

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
    prisma.registration.findUnique.mockResolvedValue({
      id: 'reg-1',
      coopId: COOP_ID,
      status: 'PENDING_PAYMENT',
      totalAmount: 100,
      isGift: false,
    });
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

    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
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
    prisma.registration.findUnique.mockResolvedValue(null);

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan', OGM), 'generic');

    expect(prisma.registration.findUnique).toHaveBeenCalledWith({ where: { ogmCode: OGM } });
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
    prisma.registration.findUnique.mockResolvedValue({
      id: 'reg-other',
      coopId: 'some-other-coop',
      status: 'PENDING_PAYMENT',
      totalAmount: 100,
      isGift: false,
    });

    await service.importCsv(COOP_ID, IMPORTER_ID, 'test.csv', csv('2026-01-15', '100', 'Jan', OGM), 'generic');

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ matchStatus: 'UNMATCHED' }) }),
    );
  });
});
