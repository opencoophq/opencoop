// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock it
// before any import that could trigger the chain.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { RegistrationsService } from '../registrations/registrations.service';

describe('ChannelsService.publicRegister — orphan-shareholder preflight', () => {
  let service: ChannelsService;
  let prisma: any;
  let shareholdersService: any;
  let registrationsService: any;

  const baseCoop = {
    id: 'coop-1',
    slug: 'bronsgroen',
    shareClasses: [{ id: 'sc-1', isActive: true }],
    projects: [],
  };
  const baseChannel = {
    id: 'ch-1',
    coopId: 'coop-1',
    slug: 'default',
    active: true,
    termsUrl: null,
    shareClasses: [{ shareClassId: 'sc-1' }],
    projects: [],
  };

  beforeEach(async () => {
    prisma = {
      coop: { findUnique: jest.fn().mockResolvedValue(baseCoop) },
      channel: { findFirst: jest.fn().mockResolvedValue(baseChannel) },
      shareholder: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ email: 'x@y.com', user: null }),
      },
    };
    shareholdersService = { create: jest.fn() };
    registrationsService = {
      createBuy: jest.fn().mockResolvedValue({ id: 'reg-1', ogmCode: '+++000/0001/00097+++' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: {} },
        { provide: ShareholdersService, useValue: shareholdersService },
        { provide: RegistrationsService, useValue: registrationsService },
      ],
    }).compile();
    service = moduleRef.get(ChannelsService);
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

    const result = await service.publicRegister('bronsgroen', 'default', dto as any);

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

    const result = await service.publicRegister('bronsgroen', 'default', dto as any);

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

    const result = await service.publicRegister('bronsgroen', 'default', dto as any);

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

    await service.publicRegister('bronsgroen', 'default', { ...dto, isGift: true } as any);

    expect(prisma.shareholder.findFirst).not.toHaveBeenCalled();
    expect(shareholdersService.create).toHaveBeenCalledTimes(1);
  });
});
