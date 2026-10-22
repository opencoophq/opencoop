// apps/api/src/modules/audience-sync/audience-sync.scheduler.spec.ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceSyncScheduler } from './audience-sync.scheduler';

describe('AudienceSyncScheduler', () => {
  it('enqueues one reconcile-all per enabled coop', async () => {
    const prisma = { coop: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AudienceSyncScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('audience-sync'), useValue: queue },
      ],
    }).compile();

    await mod.get(AudienceSyncScheduler).nightlyTick();

    expect(prisma.coop.findMany).toHaveBeenCalledWith({
      where: { emailAudienceProvider: { not: null } },
      select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'a', trigger: 'cron' },
      { jobId: 'reconcile-all:a', removeOnComplete: true, removeOnFail: true },
    );
  });

  it('skips a coop whose reconcile-all job is already active', async () => {
    const prisma = { coop: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    const queue = {
      getJob: jest.fn().mockImplementation(async (jobId: string) => {
        if (jobId === 'reconcile-all:a') return { getState: async () => 'active' };
        return null;
      }),
      add: jest.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AudienceSyncScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('audience-sync'), useValue: queue },
      ],
    }).compile();

    await mod.get(AudienceSyncScheduler).nightlyTick();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'b', trigger: 'cron' },
      expect.objectContaining({ jobId: 'reconcile-all:b' }),
    );
  });

  it('continues enqueuing when one coop fails', async () => {
    const prisma = {
      coop: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      },
    };
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AudienceSyncScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('audience-sync'), useValue: queue },
      ],
    }).compile();

    await expect(mod.get(AudienceSyncScheduler).nightlyTick()).resolves.toBeUndefined();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'a', trigger: 'cron' },
      expect.objectContaining({ jobId: 'reconcile-all:a' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'b', trigger: 'cron' },
      expect.objectContaining({ jobId: 'reconcile-all:b' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'c', trigger: 'cron' },
      expect.objectContaining({ jobId: 'reconcile-all:c' }),
    );
  });
});
