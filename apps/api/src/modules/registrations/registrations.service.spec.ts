// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock the whole module
// This MUST be before any imports that would trigger the chain
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DocumentsService } from '../documents/documents.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';

describe('RegistrationsService', () => {
  let service: RegistrationsService;
  let prisma: any;
  let emailService: any;

  beforeEach(async () => {
    emailService = {
      sendSharePurchaseConfirmation: jest.fn().mockResolvedValue(undefined),
      sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
      sendGiftCertificate: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      registration: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      coop: { findUnique: jest.fn().mockResolvedValue({ bankIban: null, bankBic: null }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: DocumentsService, useValue: {} },
        { provide: AdminNotificationsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(RegistrationsService);
  });

  describe('findAll — lean list payload', () => {
    it('returns lean rows with server-precomputed lastPaymentDate (max bankDate) and totalPaid (sum of amounts), and drops the full payments array', async () => {
      const row = {
        id: 'r1',
        type: 'BUY',
        status: 'COMPLETED',
        quantity: 10,
        pricePerShare: 25,
        totalAmount: 250,
        ogmCode: '+++123/4567/89012+++',
        isSavings: true,
        createdAt: new Date('2024-06-01T00:00:00Z'),
        shareholder: {
          id: 'sh-1',
          type: 'INDIVIDUAL',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
        },
        shareClass: { name: 'A' },
        // Ordered bankDate ASC by the query; last element is the MAX date.
        payments: [
          { bankDate: new Date('2024-02-01T00:00:00Z'), amount: '100' },
          { bankDate: new Date('2024-03-15T00:00:00Z'), amount: 150.5 },
        ],
      };

      prisma.registration.findMany.mockResolvedValueOnce([row]);
      prisma.registration.count.mockResolvedValueOnce(1);

      const result = await service.findAll('coop-1', { pageSize: 10000 });

      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      const item = result.items[0] as Record<string, unknown>;

      // Parity: lastPaymentDate = last (max) payment bankDate after ASC ordering.
      expect(item.lastPaymentDate).toEqual(new Date('2024-03-15T00:00:00Z'));
      // Parity: totalPaid = sum of Number(amount) — mixed string/number, like the old client-side reduce.
      expect(item.totalPaid).toBe(250.5);

      // Lean: the full payments array is not leaked into the response.
      expect(item.payments).toBeUndefined();
      // Scalars the table renders are preserved.
      expect(item.totalAmount).toBe(250);
      expect((item.shareholder as Record<string, unknown>).firstName).toBe('Jan');
      expect((item.shareClass as Record<string, unknown>).name).toBe('A');
    });

    it('returns lastPaymentDate=null and totalPaid=0 when there are no payments', async () => {
      const row = {
        id: 'r2',
        type: 'BUY',
        status: 'PENDING_PAYMENT',
        quantity: 1,
        pricePerShare: 25,
        totalAmount: 25,
        ogmCode: null,
        isSavings: false,
        createdAt: new Date('2024-06-01T00:00:00Z'),
        shareholder: { id: 'sh-2', type: 'INDIVIDUAL', firstName: 'Els', lastName: 'Devos', companyName: null },
        shareClass: { name: 'A' },
        payments: [],
      };

      prisma.registration.findMany.mockResolvedValueOnce([row]);
      prisma.registration.count.mockResolvedValueOnce(1);

      const result = await service.findAll('coop-1', {});
      const item = result.items[0] as Record<string, unknown>;

      expect(item.lastPaymentDate).toBeNull();
      expect(item.totalPaid).toBe(0);
      expect(item.payments).toBeUndefined();
    });
  });

  describe('resendPaymentEmail', () => {
    it('uses shareholder.email when available', async () => {
      prisma.registration.findFirst.mockResolvedValue({
        id: 'r1',
        coopId: 'c1',
        quantity: 5,
        totalAmount: 500,
        ogmCode: null,
        shareholder: {
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          email: 'jan@direct.com',
          user: null,
        },
        shareClass: { name: 'A' },
      });

      const result = await service.resendPaymentEmail('r1', 'c1');
      expect(result.sentTo).toBe('jan@direct.com');
      expect(emailService.sendSharePurchaseConfirmation).toHaveBeenCalledWith(
        'c1',
        'jan@direct.com',
        expect.objectContaining({ shareholderName: 'Jan Peeters' }),
      );
    });

    it('uses user.email when shareholder.email is null (shared household)', async () => {
      prisma.registration.findFirst.mockResolvedValue({
        id: 'r2',
        coopId: 'c1',
        quantity: 2,
        totalAmount: 200,
        ogmCode: null,
        shareholder: {
          firstName: 'Marie',
          lastName: 'Janssen',
          companyName: null,
          email: null,
          user: { email: 'shared@family.com' },
        },
        shareClass: { name: 'B' },
      });

      const result = await service.resendPaymentEmail('r2', 'c1');
      expect(result.sentTo).toBe('shared@family.com');
      expect(emailService.sendSharePurchaseConfirmation).toHaveBeenCalledWith(
        'c1',
        'shared@family.com',
        expect.objectContaining({ shareholderName: 'Marie Janssen' }),
      );
    });

    it('throws BadRequestException when shareholder has no resolvable email', async () => {
      prisma.registration.findFirst.mockResolvedValue({
        id: 'r3',
        coopId: 'c1',
        quantity: 1,
        totalAmount: 100,
        ogmCode: null,
        shareholder: {
          firstName: 'Postal',
          lastName: 'Only',
          companyName: null,
          email: null,
          user: null,
        },
        shareClass: { name: 'A' },
      });

      await expect(service.resendPaymentEmail('r3', 'c1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when registration does not exist', async () => {
      prisma.registration.findFirst.mockResolvedValue(null);
      await expect(service.resendPaymentEmail('nonexistent', 'c1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('onRegistrationCompleted', () => {
    it('sends gift certificate using user.email when shareholder.email is null (shared household)', async () => {
      // Mock the DocumentsService that was created in the module
      const documentsService = service['documentsService'];
      documentsService.generateGiftCertificatePdf = jest.fn().mockResolvedValue('/path/to/cert.pdf');

      // Setup findUnique to handle both the initial registration fetch and gift code uniqueness check
      prisma.registration.findUnique.mockImplementation(async (args: any) => {
        // For gift code uniqueness check (giftCode: <value> in where clause)
        if (args.where.giftCode !== undefined) {
          return null; // Indicates the gift code is unique
        }
        // For the initial registration fetch
        return {
          id: 'giftReg1',
          coopId: 'c1',
          isGift: true,
          giftCode: null,
          type: 'BUY',
          quantity: 10,
          totalAmount: '1000',
          shareholder: {
            id: 'sh1',
            type: 'INDIVIDUAL',
            firstName: 'Alice',
            lastName: 'Smith',
            companyName: null,
            email: null,
            user: {
              preferredLanguage: 'nl',
              email: 'alice@shared-family.com'
            },
          },
          shareClass: { id: 'sc1', name: 'Class A' },
          coop: { id: 'c1', name: 'Test Coop' },
        };
      });

      // Mock the update call for setting giftCode
      prisma.registration.update = jest.fn().mockResolvedValue({ giftCode: 'GIFT123' });

      const result = await service.onRegistrationCompleted('giftReg1');

      expect(emailService.sendGiftCertificate).toHaveBeenCalledWith(
        'c1',
        'alice@shared-family.com',
        expect.objectContaining({
          buyerName: 'Alice Smith',
          coopName: 'Test Coop',
          shareClassName: 'Class A',
          quantity: 10,
          totalValue: 1000,
        }),
      );
    });
  });
});
