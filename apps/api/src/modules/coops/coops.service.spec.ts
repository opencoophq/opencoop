// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock it
// before any import that could trigger the chain.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { CoopsService } from './coops.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

describe('CoopsService.publicRegister — orphan-shareholder preflight', () => {
  let service: CoopsService;
  let prisma: any;
  let shareholdersService: any;
  let registrationsService: any;

  const baseCoop = {
    id: 'coop-1',
    slug: 'bronsgroen',
    shareClasses: [{ id: 'sc-1', isActive: true }],
    projects: [],
  };

  beforeEach(async () => {
    prisma = {
      coop: { findUnique: jest.fn().mockResolvedValue(baseCoop) },
      shareholder: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    shareholdersService = { create: jest.fn() };
    registrationsService = {
      createBuy: jest.fn().mockResolvedValue({ id: 'reg-1', ogmCode: '+++000/0001/00097+++' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoopsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShareholdersService, useValue: shareholdersService },
        { provide: RegistrationsService, useValue: registrationsService },
        { provide: AuditService, useValue: {} },
        { provide: EmailService, useValue: { sendReferralSuccessNotification: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CoopsService);
  });

  const dto = {
    type: 'INDIVIDUAL' as const,
    firstName: 'Els',
    lastName: 'Rinkes',
    email: 'Els.Rinkes@telenet.be',
    shareClassId: 'sc-1',
    quantity: 1,
    privacyAccepted: true,
  };

  it('returns existing_shareholder (orphan) when email matches a migrated shareholder with no user account', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({ userId: null });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(result).toEqual({
      status: 'existing_shareholder',
      email: 'els.rinkes@telenet.be',
      hasUserAccount: false,
    });
    expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
      where: { coopId: 'coop-1', email: 'els.rinkes@telenet.be' },
      select: { userId: true },
    });
    expect(shareholdersService.create).not.toHaveBeenCalled();
    expect(registrationsService.createBuy).not.toHaveBeenCalled();
  });

  it('returns existing_shareholder with hasUserAccount=true when email matches a linked shareholder', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({ userId: 'user-9' });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(result).toEqual({
      status: 'existing_shareholder',
      email: 'els.rinkes@telenet.be',
      hasUserAccount: true,
    });
    expect(shareholdersService.create).not.toHaveBeenCalled();
  });

  it('proceeds with normal registration when email is new', async () => {
    prisma.shareholder.findFirst.mockResolvedValue(null);
    shareholdersService.create.mockResolvedValue({ id: 'sh-new' });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(shareholdersService.create).toHaveBeenCalledTimes(1);
    expect(registrationsService.createBuy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'registered',
      registrationId: 'reg-1',
      shareholderId: 'sh-new',
    });
  });

  it('skips preflight entirely when dto.isGift=true (recipient-email collision must not block anonymous gift buyers)', async () => {
    shareholdersService.create.mockResolvedValue({ id: 'sh-new' });

    await service.publicRegister('bronsgroen', { ...dto, isGift: true } as any);

    expect(prisma.shareholder.findFirst).not.toHaveBeenCalled();
    expect(shareholdersService.create).toHaveBeenCalledTimes(1);
  });
});
