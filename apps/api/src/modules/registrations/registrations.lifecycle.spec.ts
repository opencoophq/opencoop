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
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { OgmService } from '../ogm/ogm.service';

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
  let shareholderStatus: { recompute: jest.Mock; recomputeMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      registration: {
        create: jest.fn().mockResolvedValue({ id: 'registration-created' }),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      payment: { create: jest.fn().mockResolvedValue({}) },
      shareholder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'to-sh' }),
        findUnique: jest.fn(),
      },
      coop: { findUnique: jest.fn() },
      // Run the transaction callback synchronously against the same mock prisma
      $transaction: jest.fn((cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    shareholderStatus = {
      recompute: jest.fn().mockResolvedValue(null),
      recomputeMany: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: DocumentsService, useValue: {} },
        { provide: AdminNotificationsService, useValue: {} },
        { provide: ShareholderStatusService, useValue: shareholderStatus },
        { provide: OgmService, useValue: { nextOgmCode: jest.fn() } },
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

  describe('checkEcoPowerThreshold', () => {
    it('counts approved sells awaiting payout (PENDING_PAYMENT) as committed shares', async () => {
      prisma.shareholder.findUnique.mockResolvedValue({ isEcoPowerClient: true });
      prisma.coop.findUnique.mockResolvedValue({
        ecoPowerEnabled: true,
        ecoPowerMinThresholdType: 'SHARES',
        ecoPowerMinThreshold: 5,
      });
      prisma.registration.findMany = jest.fn().mockResolvedValue([
        { type: 'BUY', quantity: 10, pricePerShare: 10, payments: [{ amount: 100 }] },
        { type: 'SELL', quantity: 4, pricePerShare: 10, payments: [] },
      ]);

      // 10 owned - 4 committed - 2 new = 4 < 5
      await expect((service as any).checkEcoPowerThreshold('c1', 'sh1', 2, 10)).rejects.toThrow(
        BadRequestException,
      );

      const where = prisma.registration.findMany.mock.calls[0][0].where;
      expect(where.OR).toContainEqual({
        type: 'SELL',
        status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      });
    });
  });

  describe('shareholder status hooks', () => {
    it('recomputes status when a registration is completed', async () => {
      jest.restoreAllMocks();
      prisma.registration.findUnique.mockResolvedValue({
        id: 'r1',
        shareholderId: 'sh1',
        isGift: false,
        type: 'SELL',
        giftCode: null,
        shareholder: { email: null, user: null },
      });

      await service.onRegistrationCompleted('r1');

      expect(shareholderStatus.recompute).toHaveBeenCalledWith('sh1');
    });

    it('recomputes both shareholders after a transfer transaction commits', async () => {
      prisma.registration.findFirst.mockResolvedValue({
        id: 'buy-1',
        shareClassId: 'class-1',
        projectId: null,
        quantity: 10,
        pricePerShare: 10,
        payments: [],
        shareClass: { id: 'class-1' },
      });
      prisma.registration.create
        .mockResolvedValueOnce({ id: 'sell-1' })
        .mockResolvedValueOnce({ id: 'buy-2' });
      jest.spyOn(service as any, 'getAvailableShares').mockResolvedValue(10);
      jest.spyOn(service as any, 'checkEcoPowerThreshold').mockResolvedValue(undefined);

      await service.createTransfer({
        coopId: 'coop-1',
        fromShareholderId: 'from-sh',
        toShareholderId: 'to-sh',
        registrationId: 'buy-1',
        quantity: 3,
      });

      expect(shareholderStatus.recomputeMany).toHaveBeenCalledWith(['from-sh', 'to-sh']);
      expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
        where: { id: 'to-sh', coopId: 'coop-1' },
        select: { id: true },
      });
    });

    it('rejects a transfer to a shareholder outside the coop', async () => {
      prisma.registration.findFirst.mockResolvedValue({
        id: 'buy-1',
        shareClassId: 'class-1',
        projectId: null,
        quantity: 10,
        pricePerShare: 10,
        payments: [],
        shareClass: { id: 'class-1' },
      });
      prisma.shareholder.findFirst.mockResolvedValue(null);
      jest.spyOn(service as any, 'getAvailableShares').mockResolvedValue(10);
      jest.spyOn(service as any, 'checkEcoPowerThreshold').mockResolvedValue(undefined);

      await expect(
        service.createTransfer({
          coopId: 'coop-1',
          fromShareholderId: 'from-sh',
          toShareholderId: 'other-coop-sh',
          registrationId: 'buy-1',
          quantity: 3,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.registration.create).not.toHaveBeenCalled();
    });
  });

  describe('row locks on sell and transfer', () => {
    const buy = {
      id: 'buy-1',
      shareClassId: 'class-1',
      projectId: null,
      quantity: 10,
      pricePerShare: 10,
      payments: [],
      shareClass: { id: 'class-1', name: 'A' },
    };
    const lockedIds = () => {
      const sql = prisma.$queryRaw.mock.calls[0][0];
      expect(sql.sql).toMatch(/FROM shareholders WHERE id IN .* ORDER BY id FOR UPDATE$/);
      return sql.values;
    };

    beforeEach(() => {
      prisma.registration.findFirst.mockResolvedValue(buy);
      prisma.registration.create.mockResolvedValue({
        id: 'sell-1',
        shareholder: { firstName: 'Ilse', lastName: 'Verbaarschot', companyName: null },
      });
      (service as any).adminNotificationsService = {
        notifyAdminsOnEvent: jest.fn().mockResolvedValue(undefined),
      };
    });

    it('createSell locks the seller, then checks availability and EcoPower with the tx client', async () => {
      const available = jest.spyOn(service, 'getAvailableShares').mockResolvedValue(10);
      const ecoPower = jest.spyOn(service, 'checkEcoPowerThreshold').mockResolvedValue(undefined);

      await service.createSell({
        coopId: 'coop-1',
        shareholderId: 'seller',
        registrationId: 'buy-1',
        quantity: 3,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(lockedIds()).toEqual(['seller', 'coop-1']);
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(prisma.registration.findFirst.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(available.mock.invocationCallOrder[0]);
      expect(available.mock.calls[0][4]).toBe(prisma);
      expect(ecoPower.mock.calls[0][4]).toBe(prisma);
      expect(prisma.registration.create).toHaveBeenCalledTimes(1);
    });

    it('createSell keeps the error message and writes nothing when the shares are gone', async () => {
      jest.spyOn(service, 'getAvailableShares').mockResolvedValue(2);

      await expect(
        service.createSell({
          coopId: 'coop-1',
          shareholderId: 'seller',
          registrationId: 'buy-1',
          quantity: 3,
        }),
      ).rejects.toThrow(
        'Sale quantity exceeds available shares (accounting for pending and completed sells)',
      );
      expect(prisma.registration.create).not.toHaveBeenCalled();
    });

    it('createTransfer locks both parties in id order inside the transaction', async () => {
      const available = jest.spyOn(service, 'getAvailableShares').mockResolvedValue(10);
      const ecoPower = jest.spyOn(service, 'checkEcoPowerThreshold').mockResolvedValue(undefined);

      await service.createTransfer({
        coopId: 'coop-1',
        fromShareholderId: 'zz-from',
        toShareholderId: 'aa-to',
        registrationId: 'buy-1',
        quantity: 3,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(lockedIds()).toEqual(['aa-to', 'zz-from', 'coop-1']);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        available.mock.invocationCallOrder[0],
      );
      expect(available.mock.calls[0][4]).toBe(prisma);
      expect(ecoPower.mock.calls[0][4]).toBe(prisma);
    });
  });
});
