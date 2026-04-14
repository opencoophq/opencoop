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
    };
    prisma = {
      registration: { findFirst: jest.fn(), findUnique: jest.fn() },
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
});
