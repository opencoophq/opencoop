// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock the whole module
// This MUST be before any imports that would trigger the chain
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { DocumentsService } from '../documents/documents.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';

/**
 * Behavioural specs for the registration state machine:
 *   approve  PENDING        -> PENDING_PAYMENT
 *   complete PENDING_PAYMENT/ACTIVE -> COMPLETED (+ residual Payment)
 *   cancel   PENDING/PENDING_PAYMENT -> CANCELLED
 *
 * These exercise the Decimal->Number arithmetic in complete() that decides the
 * residual payment amount — a regression there double-books or under-books money.
 */
describe('RegistrationsService — lifecycle', () => {
  let service: RegistrationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      registration: { update: jest.fn().mockResolvedValue({}) },
      payment: { create: jest.fn().mockResolvedValue({}) },
      // Run the transaction callback synchronously against the same mock prisma
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: DocumentsService, useValue: {} },
        { provide: AdminNotificationsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(RegistrationsService);

    // Don't run the gift-code / email side effects after complete()
    jest.spyOn(service, 'onRegistrationCompleted').mockResolvedValue(null);
  });

  const stubFindById = (fixture: any) =>
    jest.spyOn(service, 'findById').mockResolvedValue(fixture as any);

  describe('approve', () => {
    it('moves a PENDING registration to PENDING_PAYMENT', async () => {
      stubFindById({ id: 'r1', coopId: 'c1', status: 'PENDING' });

      await service.approve('r1', 'c1', 'user-1');

      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({
            status: 'PENDING_PAYMENT',
            processedByUserId: 'user-1',
          }),
        }),
      );
    });

    it('rejects when the registration is not PENDING', async () => {
      stubFindById({ id: 'r1', coopId: 'c1', status: 'ACTIVE' });

      await expect(service.approve('r1', 'c1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.registration.update).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('creates a residual Payment for the unpaid remainder (partial-paid)', async () => {
      stubFindById({
        id: 'r1',
        coopId: 'c1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        payments: [{ amount: 60 }],
      });

      await service.complete('r1', 'user-1');

      // remaining = 100 - 60 = 40
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            registrationId: 'r1',
            coopId: 'c1',
            amount: 40,
            matchedByUserId: 'user-1',
          }),
        }),
      );
      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('does NOT create a Payment when already fully paid (remaining === 0)', async () => {
      stubFindById({
        id: 'r1',
        coopId: 'c1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        payments: [{ amount: 100 }],
      });

      await service.complete('r1', 'user-1');

      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('does NOT create a (negative) Payment when overpaid (remaining < 0)', async () => {
      stubFindById({
        id: 'r1',
        coopId: 'c1',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        payments: [{ amount: 120 }],
      });

      await service.complete('r1', 'user-1');

      // remaining = -20, guarded by `if (remaining > 0)` — no payment booked
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('handles Decimal-string amounts without producing NaN', async () => {
      // totalAmount / payment amounts arrive as Prisma Decimal -> string in prod
      stubFindById({
        id: 'r1',
        coopId: 'c1',
        status: 'ACTIVE',
        totalAmount: '250.50',
        payments: [{ amount: '100.25' }, { amount: '50.00' }],
      });

      await service.complete('r1', 'user-1');

      // remaining = 250.50 - 150.25 = 100.25
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 100.25 }),
        }),
      );
    });

    it('rejects completing an already-COMPLETED registration', async () => {
      stubFindById({
        id: 'r1',
        coopId: 'c1',
        status: 'COMPLETED',
        totalAmount: 100,
        payments: [],
      });

      await expect(service.complete('r1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.registration.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING registration with the supplied reason', async () => {
      stubFindById({ id: 'r1', coopId: 'c1', status: 'PENDING' });

      await service.cancel('r1', 'c1', 'user-1', 'duplicate');

      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({
            status: 'CANCELLED',
            rejectionReason: 'duplicate',
            processedByUserId: 'user-1',
          }),
        }),
      );
    });

    it('cancels a PENDING_PAYMENT registration', async () => {
      stubFindById({ id: 'r1', coopId: 'c1', status: 'PENDING_PAYMENT' });

      await service.cancel('r1', 'c1', 'user-1');

      expect(prisma.registration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED', rejectionReason: null }),
        }),
      );
    });

    it('rejects cancelling a COMPLETED registration', async () => {
      stubFindById({ id: 'r1', coopId: 'c1', status: 'COMPLETED' });

      await expect(service.cancel('r1', 'c1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.registration.update).not.toHaveBeenCalled();
    });
  });
});
