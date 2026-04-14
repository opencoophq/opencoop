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
      updateMany: jest.fn(),
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
    it('should return empty shareholders array for unknown emails', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.queryShareholders('coop1', ['unknown@test.com']);

      expect(results).toEqual([{ email: 'unknown@test.com', shareholders: [] }]);
    });

    it('should return shareholder data with calculated share totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          user: null,
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
          shareholders: [
            {
              firstName: 'Jan',
              lastName: 'Peeters',
              companyName: null,
              type: 'INDIVIDUAL',
              totalShares: 10,
              totalShareValue: 250,
              isEcoPowerClient: true,
              ecoPowerId: '2079183',
            },
          ],
        },
      ]);
    });

    it('should subtract sells from totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          user: null,
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

      expect(results[0].shareholders[0].totalShares).toBe(7);
      expect(results[0].shareholders[0].totalShareValue).toBe(175);
    });

    it('should return array per email when email is shared across household (multiple shareholders)', async () => {
      // Two shareholders (Jan and Marie) share the same household email
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'household@test.com',
          user: null,
          firstName: 'Jan',
          lastName: 'Janssens',
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
          ],
        },
        {
          email: 'household@test.com',
          user: null,
          firstName: 'Marie',
          lastName: 'Janssens',
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

      const results = await service.queryShareholders('coop1', ['household@test.com']);

      expect(results).toHaveLength(1);
      expect(results[0].email).toBe('household@test.com');
      expect(results[0].shareholders).toHaveLength(2);
      expect(results[0].shareholders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ firstName: 'Jan', totalShares: 10, totalShareValue: 250 }),
          expect.objectContaining({ firstName: 'Marie', totalShares: 5, totalShareValue: 125 }),
        ]),
      );
    });

    it('should match shareholders linked via user.email when shareholder.email is null', async () => {
      // A household-linked shareholder has no direct email — their user account email is used
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: null,
          user: { email: 'shared@household.com' },
          firstName: 'Marie',
          lastName: 'Janssens',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [
            {
              type: 'BUY',
              quantity: 4,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 100 }],
            },
          ],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['shared@household.com']);

      expect(results).toHaveLength(1);
      expect(results[0].email).toBe('shared@household.com');
      expect(results[0].shareholders).toHaveLength(1);
      expect(results[0].shareholders[0]).toMatchObject({
        firstName: 'Marie',
        totalShares: 4,
        totalShareValue: 100,
      });
    });

    it('should return empty shareholders array when email does not match', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.queryShareholders('coop1', ['nobody@example.com']);

      expect(results).toEqual([{ email: 'nobody@example.com', shareholders: [] }]);
    });

    it('should preserve input emails array order in the return', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'b@test.com',
          user: null,
          firstName: 'B',
          lastName: 'User',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [],
        },
        {
          email: 'a@test.com',
          user: null,
          firstName: 'A',
          lastName: 'User',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['a@test.com', 'b@test.com', 'c@test.com']);

      expect(results[0].email).toBe('a@test.com');
      expect(results[1].email).toBe('b@test.com');
      expect(results[2].email).toBe('c@test.com');
      expect(results[2].shareholders).toEqual([]);
    });

    it('should query using both shareholder.email and user.email (OR condition)', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      await service.queryShareholders('coop1', ['jan@test.com']);

      expect(mockPrisma.shareholder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            coopId: 'coop1',
            OR: expect.arrayContaining([
              expect.objectContaining({ email: expect.objectContaining({ in: ['jan@test.com'] }) }),
              expect.objectContaining({ user: expect.objectContaining({ email: expect.anything() }) }),
            ]),
          }),
        }),
      );
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
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'unknown@test.com', isEcoPowerClient: true },
      ]);

      expect(results).toEqual([{ email: 'unknown@test.com', success: false, error: 'not found' }]);
    });

    it('should update Ecopower status and id for a single match', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([{ id: 'sh1', email: 'jan@test.com', user: null }]);
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

    it('should apply updateEcoPowerStatus to all matching shareholders in a household', async () => {
      // Two shareholders share the same household email
      mockPrisma.shareholder.findMany.mockResolvedValue([
        { id: 'sh1', email: 'household@test.com', user: null },
        { id: 'sh2', email: 'household@test.com', user: null },
      ]);
      mockPrisma.shareholder.update.mockResolvedValue({});

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'household@test.com', isEcoPowerClient: true, ecoPowerId: 'ECO-999' },
      ]);

      expect(results).toEqual([{ email: 'household@test.com', success: true }]);
      expect(mockPrisma.shareholder.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.shareholder.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { isEcoPowerClient: true, ecoPowerId: 'ECO-999' },
      });
      expect(mockPrisma.shareholder.update).toHaveBeenCalledWith({
        where: { id: 'sh2' },
        data: { isEcoPowerClient: true, ecoPowerId: 'ECO-999' },
      });
    });

    it('should match via user.email for updateEcoPowerStatus', async () => {
      // Shareholder has no direct email, linked via user account
      mockPrisma.shareholder.findMany.mockResolvedValue([
        { id: 'sh1', email: null, user: { email: 'jan@test.com' } },
      ]);
      mockPrisma.shareholder.update.mockResolvedValue({});

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'jan@test.com', isEcoPowerClient: true },
      ]);

      expect(results).toEqual([{ email: 'jan@test.com', success: true }]);
      expect(mockPrisma.shareholder.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { isEcoPowerClient: true },
      });
    });
  });
});
