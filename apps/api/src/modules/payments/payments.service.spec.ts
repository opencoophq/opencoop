// documents.service (pulled in transitively via registrations.service) imports
// @react-pdf/renderer (ESM-only). Mock the whole module before any imports trigger the chain.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';

describe('PaymentsService.addPayment tenant isolation', () => {
  let service: PaymentsService;
  let prisma: any;
  let registrationsService: { onRegistrationCompleted: jest.Mock };
  let shareholderStatus: { recompute: jest.Mock };

  beforeEach(async () => {
    prisma = {
      registration: { findUnique: jest.fn(), update: jest.fn() },
      payment: { create: jest.fn() },
    };
    registrationsService = { onRegistrationCompleted: jest.fn().mockResolvedValue(null) };
    shareholderStatus = { recompute: jest.fn().mockResolvedValue(null) };
    const mod = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RegistrationsService, useValue: registrationsService },
        { provide: AdminNotificationsService, useValue: { notifyAdminsOnEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: ShareholderStatusService, useValue: shareholderStatus },
      ],
    }).compile();
    service = mod.get(PaymentsService);
  });

  it('rejects a payment when the registration belongs to another coop', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      id: 'reg-B', coopId: 'coop-B', status: 'PENDING_PAYMENT', totalAmount: 100, payments: [],
    });
    await expect(
      service.addPayment({ registrationId: 'reg-B', coopId: 'coop-A', amount: 50, bankDate: new Date() }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('accepts a payment for a registration in the caller coop', async () => {
    prisma.registration.findUnique
      .mockResolvedValueOnce({ id: 'reg-A', coopId: 'coop-A', shareholderId: 'sh-A', status: 'PENDING_PAYMENT', totalAmount: 100, payments: [] })
      .mockResolvedValueOnce({ id: 'reg-A', coopId: 'coop-A', shareholder: { firstName: 'Jan', lastName: 'Peeters', companyName: null } });
    prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: 50 });
    prisma.registration.update.mockResolvedValue({});
    const result = await service.addPayment({ registrationId: 'reg-A', coopId: 'coop-A', amount: 50, bankDate: new Date() });
    expect(result).toEqual({ id: 'pay-1', amount: 50 });
    expect(prisma.payment.create).toHaveBeenCalled();
    expect(shareholderStatus.recompute).toHaveBeenCalledWith('sh-A');
  });

  it('calls onRegistrationCompleted for a fully paid registration', async () => {
    prisma.registration.findUnique
      .mockResolvedValueOnce({
        id: 'reg-A',
        coopId: 'coop-A',
        shareholderId: 'sh-A',
        status: 'PENDING_PAYMENT',
        totalAmount: 100,
        payments: [],
      })
      .mockResolvedValueOnce({
        id: 'reg-A',
        coopId: 'coop-A',
        shareholder: { firstName: 'Jan', lastName: 'Peeters', companyName: null },
      });
    prisma.payment.create.mockResolvedValue({ id: 'pay-1', amount: 100 });
    prisma.registration.update.mockResolvedValue({});

    await service.addPayment({
      registrationId: 'reg-A',
      coopId: 'coop-A',
      amount: 100,
      bankDate: new Date(),
    });

    expect(registrationsService.onRegistrationCompleted).toHaveBeenCalledWith('reg-A');
    expect(shareholderStatus.recompute).not.toHaveBeenCalled();
  });

  it('lists up to 100 unlinked payments with exact amount and shareholder search filters', async () => {
    prisma.payment.findMany = jest.fn().mockResolvedValue([]);

    await service.findUnlinkedByCoopId('coop-A', 'Jan', '100.00');

    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        coopId: 'coop-A',
        bankTransactionId: null,
        amount: '100.00',
        registration: {
          shareholder: {
            OR: [
              { firstName: { contains: 'Jan', mode: 'insensitive' } },
              { lastName: { contains: 'Jan', mode: 'insensitive' } },
              { companyName: { contains: 'Jan', mode: 'insensitive' } },
            ],
          },
        },
      }),
      include: expect.any(Object),
      orderBy: { bankDate: 'desc' },
      take: 100,
    });
  });
});
