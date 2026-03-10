jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: any) => s },
  renderToBuffer: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { ExternalApiService } from './external-api.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExternalApiService', () => {
  let service: ExternalApiService;

  const mockPrisma = {
    shareholder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ExternalApiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExternalApiService>(ExternalApiService);
    jest.clearAllMocks();
  });

  describe('queryShareholders', () => {
    it('should return found:false for unknown emails', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.queryShareholders('coop1', ['unknown@test.com']);

      expect(results).toEqual([{ email: 'unknown@test.com', found: false }]);
    });

    it('should return shareholder data with calculated share totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: true,
          ecoPowerId: '2079183',
          registrations: [
            {
              type: 'BUY',
              quantity: 10,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 250 }],
            },
          ],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['jan@test.com']);

      expect(results).toEqual([
        {
          email: 'jan@test.com',
          found: true,
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          totalShares: 10,
          totalShareValue: 250,
          isEcoPowerClient: true,
          ecoPowerId: '2079183',
        },
      ]);
    });

    it('should subtract sells from totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [
            {
              type: 'BUY',
              quantity: 10,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 250 }],
            },
            {
              type: 'SELL',
              quantity: 3,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [],
            },
          ],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['jan@test.com']);

      expect(results[0].totalShares).toBe(7);
      expect(results[0].totalShareValue).toBe(175);
    });
  });

  describe('searchByName', () => {
    it('should return empty array when no matches', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.searchByName('coop1', 'Unknown Person');

      expect(results).toEqual([]);
      expect(mockPrisma.shareholder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            coopId: 'coop1',
            AND: [
              { OR: [{ firstName: { contains: 'Unknown', mode: 'insensitive' } }, { lastName: { contains: 'Unknown', mode: 'insensitive' } }] },
              { OR: [{ firstName: { contains: 'Person', mode: 'insensitive' } }, { lastName: { contains: 'Person', mode: 'insensitive' } }] },
            ],
          },
        }),
      );
    });

    it('should return shareholder data with share totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          id: 'sh1',
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [
            {
              type: 'BUY',
              quantity: 5,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 125 }],
            },
          ],
        },
      ]);

      const results = await service.searchByName('coop1', 'Jan Peeters');

      expect(results).toEqual([
        {
          id: 'sh1',
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          totalShares: 5,
          totalShareValue: 125,
          isEcoPowerClient: false,
          ecoPowerId: null,
        },
      ]);
    });

    it('should handle single-word name search', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      await service.searchByName('coop1', 'Peeters');

      expect(mockPrisma.shareholder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            coopId: 'coop1',
            AND: [
              { OR: [{ firstName: { contains: 'Peeters', mode: 'insensitive' } }, { lastName: { contains: 'Peeters', mode: 'insensitive' } }] },
            ],
          },
        }),
      );
    });
  });

  describe('updateEcoPowerStatus', () => {
    it('should return not found for unknown emails', async () => {
      mockPrisma.shareholder.findFirst.mockResolvedValue(null);

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'unknown@test.com', isEcoPowerClient: true },
      ]);

      expect(results).toEqual([{ email: 'unknown@test.com', success: false, error: 'not found' }]);
    });

    it('should update Ecopower status and id', async () => {
      mockPrisma.shareholder.findFirst.mockResolvedValue({ id: 'sh1' });
      mockPrisma.shareholder.update.mockResolvedValue({});

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'jan@test.com', isEcoPowerClient: true, ecoPowerId: '2079183' },
      ]);

      expect(results).toEqual([{ email: 'jan@test.com', success: true }]);
      expect(mockPrisma.shareholder.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { isEcoPowerClient: true, ecoPowerId: '2079183' },
      });
    });
  });
});
