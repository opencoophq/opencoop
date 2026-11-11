// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock it
// before any import that could trigger the chain.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LAPSED_SIGNUP_GRACE_MS, PublicSignupClosedException } from '../billing/signup-grace';
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
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
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

  it('refuses an anonymous purchase against someone else shareholder id', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({
      id: 'sh-jan',
      userId: 'user-jan',
      type: 'INDIVIDUAL',
      registeredByUserId: null,
    });

    await expect(
      service.publicRegister('bronsgroen', 'default', { ...dto, shareholderId: 'sh-jan' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(registrationsService.createBuy).not.toHaveBeenCalled();
  });

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

  it('refuses public signup once the 14-day lapse grace has ended', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...baseCoop, plan: 'PROFESSIONAL' });
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'UNPAID',
      lapsedAt: new Date(Date.now() - LAPSED_SIGNUP_GRACE_MS),
    });

    await expect(service.publicRegister('bronsgroen', 'default', dto as any)).rejects.toBeInstanceOf(
      PublicSignupClosedException,
    );
    expect(shareholdersService.create).not.toHaveBeenCalled();
    expect(registrationsService.createBuy).not.toHaveBeenCalled();
  });

  it('still accepts public signup during the lapse grace window', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...baseCoop, plan: 'PROFESSIONAL' });
    prisma.subscription.findUnique.mockResolvedValue({ status: 'INCOMPLETE', lapsedAt: new Date() });
    prisma.shareholder.findFirst.mockResolvedValue(null);
    shareholdersService.create.mockResolvedValue({ id: 'sh-new' });

    await expect(service.publicRegister('bronsgroen', 'default', dto as any)).resolves.toMatchObject({
      status: 'registered',
    });
  });
});

describe('ChannelsService admin share class and project ownership', () => {
  let service: ChannelsService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      channelShareClass: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      channelProject: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      channel: { update: jest.fn().mockResolvedValue({ id: 'ch-1' }) },
    };
    prisma = {
      channel: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'ch-1' }),
      },
      shareClass: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn(), diff: jest.fn().mockReturnValue([]) } },
        { provide: ShareholdersService, useValue: {} },
        { provide: RegistrationsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ChannelsService);
  });

  const createDto = { name: 'Web', slug: 'web' } as any;

  describe('create', () => {
    beforeEach(() => prisma.channel.findFirst.mockResolvedValue(null));

    it('rejects a share class from another coop before writing', async () => {
      prisma.shareClass.findMany.mockResolvedValue([{ id: 'sc-1' }]);

      await expect(
        service.create('coop-1', { ...createDto, shareClassIds: ['sc-1', 'sc-other'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.shareClass.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sc-1', 'sc-other'] }, coopId: 'coop-1' },
        select: { id: true },
      });
      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it('rejects a project from another coop before writing', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await expect(
        service.create('coop-1', { ...createDto, projectIds: ['p-other'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['p-other'] }, coopId: 'coop-1' },
        select: { id: true },
      });
      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it('accepts own ids and ignores duplicates in the input', async () => {
      prisma.shareClass.findMany.mockResolvedValue([{ id: 'sc-1' }]);
      prisma.project.findMany.mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }]);

      await service.create('coop-1', {
        ...createDto,
        shareClassIds: ['sc-1', 'sc-1'],
        projectIds: ['p-1', 'p-2'],
      });

      expect(prisma.channel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shareClasses: { create: [{ shareClassId: 'sc-1' }] },
            projects: { create: [{ projectId: 'p-1' }, { projectId: 'p-2' }] },
          }),
        }),
      );
    });

    it('does not query when no ids are given', async () => {
      await service.create('coop-1', createDto);

      expect(prisma.shareClass.findMany).not.toHaveBeenCalled();
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => prisma.channel.findFirst.mockResolvedValue({ id: 'ch-1', coopId: 'coop-1' }));

    it('rejects a foreign share class and leaves the links untouched', async () => {
      prisma.shareClass.findMany.mockResolvedValue([]);

      await expect(
        service.update('ch-1', 'coop-1', { shareClassIds: ['sc-other'] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.channelShareClass.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects a foreign project and leaves the links untouched', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await expect(
        service.update('ch-1', 'coop-1', { projectIds: ['p-other'] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('replaces links with own ids, deduplicated', async () => {
      prisma.shareClass.findMany.mockResolvedValue([{ id: 'sc-1' }]);

      await service.update('ch-1', 'coop-1', { shareClassIds: ['sc-1', 'sc-1'] } as any);

      expect(tx.channelShareClass.createMany).toHaveBeenCalledWith({
        data: [{ channelId: 'ch-1', shareClassId: 'sc-1' }],
      });
    });

    it('clears links with an empty list without querying', async () => {
      await service.update('ch-1', 'coop-1', { shareClassIds: [], projectIds: [] } as any);

      expect(prisma.shareClass.findMany).not.toHaveBeenCalled();
      expect(tx.channelShareClass.deleteMany).toHaveBeenCalled();
      expect(tx.channelShareClass.createMany).not.toHaveBeenCalled();
    });
  });
});
