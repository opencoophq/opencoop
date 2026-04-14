import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProxiesService } from './proxies.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProxiesService', () => {
  let service: ProxiesService;
  let prisma: {
    meeting: { findUnique: jest.Mock };
    shareholder: { findUnique: jest.Mock };
    proxy: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };

  const meeting = { id: 'm1', coopId: 'c1', maxProxiesPerPerson: 1 };
  const grantorSh = { id: 'sA', coopId: 'c1' };
  const delegateSh = { id: 'sB', coopId: 'c1' };

  beforeEach(async () => {
    prisma = {
      meeting: { findUnique: jest.fn() },
      shareholder: { findUnique: jest.fn() },
      proxy: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ProxiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ProxiesService);
  });

  it('rejects self-delegation', async () => {
    await expect(service.create('c1', 'm1', 'sA', 'sA')).rejects.toThrow(BadRequestException);
    expect(prisma.proxy.create).not.toHaveBeenCalled();
  });

  it('rejects when meeting does not belong to the caller coop', async () => {
    prisma.meeting.findUnique.mockResolvedValue({ ...meeting, coopId: 'OTHER' });
    await expect(service.create('c1', 'm1', 'sA', 'sB')).rejects.toThrow(ForbiddenException);
    expect(prisma.proxy.create).not.toHaveBeenCalled();
  });

  it('rejects cross-coop delegate', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce({ id: 'sX', coopId: 'OTHER' });
    prisma.proxy.count.mockResolvedValue(0);

    await expect(service.create('c1', 'm1', 'sA', 'sX')).rejects.toThrow(ForbiddenException);
    expect(prisma.proxy.create).not.toHaveBeenCalled();
  });

  it('rejects when delegate has already reached maxProxiesPerPerson', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(delegateSh);
    prisma.proxy.count.mockResolvedValue(1);

    await expect(service.create('c1', 'm1', 'sA', 'sB')).rejects.toThrow(BadRequestException);
    expect(prisma.proxy.create).not.toHaveBeenCalled();
  });

  it('creates a valid proxy when all checks pass', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(delegateSh);
    prisma.proxy.count.mockResolvedValue(0);
    const created = {
      id: 'p1',
      meetingId: 'm1',
      grantorShareholderId: 'sA',
      delegateShareholderId: 'sB',
    };
    prisma.proxy.create.mockResolvedValue(created);

    const result = await service.create('c1', 'm1', 'sA', 'sB');

    expect(result).toEqual(created);
    expect(prisma.proxy.create).toHaveBeenCalledWith({
      data: {
        meetingId: 'm1',
        grantorShareholderId: 'sA',
        delegateShareholderId: 'sB',
      },
    });
  });
});
