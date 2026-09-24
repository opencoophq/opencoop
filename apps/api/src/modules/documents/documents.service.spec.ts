jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Image: 'Image',
  Page: 'Page',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
  renderToBuffer: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => false),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
});

import { NotFoundException } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import * as fs from 'fs';
import { Test } from '@nestjs/testing';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaMock = {
  shareholder: {
    findFirst: jest.Mock;
  };
  shareholderDocument: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  registration: {
    update: jest.Mock;
  };
  dividendPayout: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const mockedRenderToBuffer = renderToBuffer as jest.MockedFunction<typeof renderToBuffer>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

const makeCoop = (id: string) => ({
  id,
  name: id === 'coop-1' ? 'Coop One' : 'Coop Two',
  slug: id,
  legalForm: null,
  foundedDate: null,
  certificateSignatory: null,
  certificateSignatureUrl: null,
  coopAddress: null,
  coopPhone: null,
  coopEmail: null,
  coopWebsite: null,
  vatNumber: null,
  bankIban: null,
  bankBic: null,
});

const makeShareholder = (coopId = 'coop-1') => ({
  id: 'shareholder-1',
  coopId,
  type: 'INDIVIDUAL',
  firstName: 'Ada',
  lastName: 'Lovelace',
  companyName: null,
  nationalId: null,
  companyId: null,
  address: { city: 'Brussels' },
  memberNumber: 42,
  coop: makeCoop(coopId),
  registrations: [
    {
      id: 'registration-1',
      quantity: 10,
      pricePerShare: 10,
      registerDate: new Date('2025-01-01T00:00:00.000Z'),
      shareClass: { name: 'Class A', code: 'A' },
      payments: [],
    },
  ],
});

const makePayout = (coopId = 'coop-1') => ({
  id: 'payout-1',
  shareholderId: 'shareholder-1',
  shareholder: makeShareholder(coopId),
  dividendPeriod: {
    year: 2025,
    name: '2025 dividend',
    exDividendDate: new Date('2025-06-01T00:00:00.000Z'),
    paymentDate: new Date('2025-07-01T00:00:00.000Z'),
    dividendRate: 0.05,
    withholdingTaxRate: 0.3,
  },
  calculationDetails: null,
  grossAmount: 10,
  withholdingTax: 3,
  netAmount: 7,
});

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      shareholder: { findFirst: jest.fn() },
      shareholderDocument: { findMany: jest.fn(), create: jest.fn() },
      registration: { update: jest.fn() },
      dividendPayout: { findUnique: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [DocumentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(DocumentsService);
    mockedRenderToBuffer.mockReset();
    mockedRenderToBuffer.mockResolvedValue(Buffer.from('pdf'));
    mockedExistsSync.mockClear();
    mockedExistsSync.mockReturnValue(false);
    mockedMkdirSync.mockClear();
    mockedMkdirSync.mockReturnValue(undefined);
    mockedWriteFileSync.mockClear();
    mockedWriteFileSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getDocuments', () => {
    it('returns documents after confirming the shareholder belongs to the coop', async () => {
      const documents = [{ id: 'document-1', shareholderId: 'shareholder-1' }];
      prisma.shareholder.findFirst.mockResolvedValue({ id: 'shareholder-1' });
      prisma.shareholderDocument.findMany.mockResolvedValue(documents);

      await expect(service.getDocuments('shareholder-1', 'coop-1')).resolves.toEqual(documents);

      expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
        where: { id: 'shareholder-1', coopId: 'coop-1' },
        select: { id: true },
      });
      expect(prisma.shareholderDocument.findMany).toHaveBeenCalledWith({
        where: { shareholderId: 'shareholder-1' },
        orderBy: { generatedAt: 'desc' },
      });
    });

    it('rejects a shareholder from another coop before querying documents', async () => {
      prisma.shareholder.findFirst.mockResolvedValue(null);

      await expect(service.getDocuments('shareholder-1', 'coop-2')).rejects.toThrow(
        new NotFoundException('Shareholder not found'),
      );

      expect(prisma.shareholderDocument.findMany).not.toHaveBeenCalled();
    });

    it('rejects a shareholder that does not exist', async () => {
      prisma.shareholder.findFirst.mockResolvedValue(null);

      await expect(service.getDocuments('missing-shareholder', 'coop-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.shareholderDocument.findMany).not.toHaveBeenCalled();
    });
  });

  describe('generateCertificate', () => {
    it('generates and records a certificate for a shareholder in the coop', async () => {
      const shareholder = makeShareholder();
      const document = { id: 'document-1', shareholderId: 'shareholder-1' };
      prisma.shareholder.findFirst.mockResolvedValue(shareholder);
      prisma.shareholderDocument.create.mockResolvedValue(document);

      await expect(service.generateCertificate('shareholder-1', 'coop-1', 'en')).resolves.toEqual(
        document,
      );

      expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
        where: { id: 'shareholder-1', coopId: 'coop-1' },
        include: {
          coop: true,
          registrations: {
            where: { type: 'BUY', status: 'COMPLETED' },
            include: {
              shareClass: true,
              payments: { select: { amount: true, bankDate: true } },
            },
          },
        },
      });
      expect(mockedRenderToBuffer).toHaveBeenCalledTimes(1);
      expect(prisma.shareholderDocument.create).toHaveBeenCalledTimes(1);
      expect(prisma.registration.update).toHaveBeenCalledTimes(1);
      expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    });

    it('rejects a shareholder from another coop before generating a PDF', async () => {
      prisma.shareholder.findFirst.mockResolvedValue(null);

      await expect(service.generateCertificate('shareholder-1', 'coop-2')).rejects.toThrow(
        new NotFoundException('Shareholder not found'),
      );

      expect(mockedRenderToBuffer).not.toHaveBeenCalled();
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      expect(prisma.shareholderDocument.create).not.toHaveBeenCalled();
      expect(prisma.registration.update).not.toHaveBeenCalled();
    });

    it('rejects a shareholder that does not exist', async () => {
      prisma.shareholder.findFirst.mockResolvedValue(null);

      await expect(service.generateCertificate('missing-shareholder', 'coop-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockedRenderToBuffer).not.toHaveBeenCalled();
    });
  });

  describe('generateDividendStatement', () => {
    it('generates and records a statement for a payout in the coop', async () => {
      const document = { id: 'document-1', shareholderId: 'shareholder-1' };
      prisma.dividendPayout.findUnique.mockResolvedValue(makePayout());
      prisma.shareholderDocument.create.mockResolvedValue(document);

      await expect(
        service.generateDividendStatement('shareholder-1', 'payout-1', 'coop-1', 'en'),
      ).resolves.toEqual(document);

      expect(prisma.dividendPayout.findUnique).toHaveBeenCalledWith({
        where: { id: 'payout-1' },
        include: {
          shareholder: { include: { coop: true } },
          dividendPeriod: true,
        },
      });
      expect(mockedRenderToBuffer).toHaveBeenCalledTimes(1);
      expect(prisma.shareholderDocument.create).toHaveBeenCalledTimes(1);
      expect(prisma.dividendPayout.update).toHaveBeenCalledTimes(1);
      expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    });

    it('rejects a payout from another coop before generating a PDF', async () => {
      prisma.dividendPayout.findUnique.mockResolvedValue(makePayout('coop-2'));

      await expect(
        service.generateDividendStatement('shareholder-1', 'payout-1', 'coop-1'),
      ).rejects.toThrow(new NotFoundException('Dividend payout not found'));

      expect(mockedRenderToBuffer).not.toHaveBeenCalled();
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      expect(prisma.shareholderDocument.create).not.toHaveBeenCalled();
      expect(prisma.dividendPayout.update).not.toHaveBeenCalled();
    });

    it('rejects a payout that does not exist', async () => {
      prisma.dividendPayout.findUnique.mockResolvedValue(null);

      await expect(
        service.generateDividendStatement('shareholder-1', 'missing-payout', 'coop-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockedRenderToBuffer).not.toHaveBeenCalled();
    });
  });
});
