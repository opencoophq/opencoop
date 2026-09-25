import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AudienceService } from './audience.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AudienceService', () => {
  let service: AudienceService;
  const prisma = {
    shareholder: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    project: { findFirst: jest.fn() },
    registration: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AudienceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AudienceService);
    jest.clearAllMocks();
  });

  it('ALL returns every active shareholder of the coop', async () => {
    prisma.shareholder.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    const r = await service.resolve('coop1', { type: 'ALL' });
    expect(r.shareholderIds).toEqual(['s1', 's2']);
    expect(prisma.shareholder.findMany).toHaveBeenCalledWith({
      where: { coopId: 'coop1', status: 'ACTIVE' },
      select: { id: true },
    });
  });

  it('PROJECT returns distinct active shareholders with a BUY registration on the project', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.registration.findMany.mockResolvedValue([
      { shareholderId: 's1' },
      { shareholderId: 's1' },
      { shareholderId: 's2' },
    ]);
    const r = await service.resolve('coop1', { type: 'PROJECT', projectId: 'p1' });
    expect(r.shareholderIds).toEqual(['s1', 's2']);
    expect(prisma.registration.findMany).toHaveBeenCalledWith({
      where: {
        coopId: 'coop1',
        projectId: 'p1',
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
        shareholder: { status: 'ACTIVE' },
      },
      select: { shareholderId: true },
    });
  });

  it('PROJECT rejects a project of another coop', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.resolve('coop1', { type: 'PROJECT', projectId: 'px' })).rejects.toThrow(NotFoundException);
  });

  it('PROJECT without projectId is a bad request', async () => {
    await expect(service.resolve('coop1', { type: 'PROJECT' })).rejects.toThrow(BadRequestException);
  });

  it('SELECTED keeps only active shareholders of this coop and drops unknown ids', async () => {
    prisma.shareholder.findMany.mockResolvedValue([{ id: 's2' }]);
    const r = await service.resolve('coop1', { type: 'SELECTED', shareholderIds: ['s2', 'ghost'] });
    expect(r.shareholderIds).toEqual(['s2']);
    expect(prisma.shareholder.findMany).toHaveBeenCalledWith({
      where: { coopId: 'coop1', status: 'ACTIVE', id: { in: ['s2', 'ghost'] } },
      select: { id: true },
    });
  });

  it('SELECTED with no ids resolves to nobody without querying', async () => {
    const r = await service.resolve('coop1', { type: 'SELECTED', shareholderIds: [] });
    expect(r.shareholderIds).toEqual([]);
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
  });

  it('DIRECT resolves its shareholder in the coop regardless of status', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({ id: 's-pending' });

    const r = await service.resolve('coop1', { type: 'DIRECT', shareholderId: 's-pending' });

    expect(r.shareholderIds).toEqual(['s-pending']);
    expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
      where: { id: 's-pending', coopId: 'coop1' },
      select: { id: true },
    });
  });

  describe('count', () => {
    it('counts active ALL shareholders without loading ids', async () => {
      prisma.shareholder.count.mockResolvedValue(7);

      await expect(service.count('coop1', { type: 'ALL' })).resolves.toBe(7);

      expect(prisma.shareholder.count).toHaveBeenCalledWith({
        where: { coopId: 'coop1', status: 'ACTIVE' },
      });
      expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
    });

    it('counts distinct active PROJECT shareholders through the shareholder relation', async () => {
      prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.shareholder.count.mockResolvedValue(2);

      await expect(service.count('coop1', { type: 'PROJECT', projectId: 'p1' })).resolves.toBe(2);

      expect(prisma.shareholder.count).toHaveBeenCalledWith({
        where: {
          coopId: 'coop1',
          status: 'ACTIVE',
          registrations: {
            some: {
              coopId: 'coop1',
              projectId: 'p1',
              type: 'BUY',
              status: { in: ['ACTIVE', 'COMPLETED'] },
            },
          },
        },
      });
      expect(prisma.registration.findMany).not.toHaveBeenCalled();
    });

    it('counts active SELECTED shareholders in the coop', async () => {
      prisma.shareholder.count.mockResolvedValue(1);

      await expect(
        service.count('coop1', { type: 'SELECTED', shareholderIds: ['s1', 'ghost'] }),
      ).resolves.toBe(1);

      expect(prisma.shareholder.count).toHaveBeenCalledWith({
        where: { coopId: 'coop1', status: 'ACTIVE', id: { in: ['s1', 'ghost'] } },
      });
    });

    it('counts a DIRECT shareholder without filtering status', async () => {
      prisma.shareholder.count.mockResolvedValue(1);

      await expect(
        service.count('coop1', { type: 'DIRECT', shareholderId: 's-pending' }),
      ).resolves.toBe(1);

      expect(prisma.shareholder.count).toHaveBeenCalledWith({
        where: { id: 's-pending', coopId: 'coop1' },
      });
    });
  });
});
