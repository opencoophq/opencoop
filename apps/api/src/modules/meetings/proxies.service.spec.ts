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
      upsert: jest.Mock;
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
        upsert: jest.fn(),
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

  const grantedRow = {
    id: 'p1',
    meetingId: 'm1',
    grantorShareholderId: 'sA',
    delegateShareholderId: 'sB',
  };

  function allChecksPass() {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(delegateSh);
    prisma.proxy.count.mockResolvedValue(0);
  }

  it('creates a valid proxy when all checks pass', async () => {
    allChecksPass();
    prisma.proxy.findUnique.mockResolvedValue(null);
    prisma.proxy.upsert.mockResolvedValue(grantedRow);

    const result = await service.create('c1', 'm1', 'sA', 'sB');

    expect(result).toEqual(grantedRow);
    expect(prisma.proxy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId_grantorShareholderId: { meetingId: 'm1', grantorShareholderId: 'sA' } },
        create: { meetingId: 'm1', grantorShareholderId: 'sA', delegateShareholderId: 'sB' },
      }),
    );
  });

  it('reactivates a revoked proxy instead of failing on the unique key', async () => {
    allChecksPass();
    prisma.proxy.findUnique.mockResolvedValue({ ...grantedRow, revokedAt: new Date() });
    prisma.proxy.upsert.mockResolvedValue(grantedRow);

    await service.create('c1', 'm1', 'sA', 'sB');

    const arg = prisma.proxy.upsert.mock.calls[0][0];
    expect(arg.update).toEqual({
      delegateShareholderId: 'sB',
      revokedAt: null,
      grantedAt: expect.any(Date),
      signedFormUrl: null,
    });
    expect(prisma.proxy.create).not.toHaveBeenCalled();
  });

  it('still rejects a second active proxy from the same grantor', async () => {
    allChecksPass();
    prisma.proxy.findUnique.mockResolvedValue({ ...grantedRow, revokedAt: null });

    await expect(service.create('c1', 'm1', 'sA', 'sB')).rejects.toThrow(BadRequestException);
    expect(prisma.proxy.upsert).not.toHaveBeenCalled();
  });
});
