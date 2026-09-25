import { Test } from '@nestjs/testing';
import { ShareholderStatus } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { ShareholderStatusService } from './shareholder-status.service';

describe('ShareholderStatusService', () => {
  let service: ShareholderStatusService;
  let prisma: any;
  let audienceQueue: any;

  beforeEach(async () => {
    prisma = {
      shareholder: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn(),
    };
    audienceQueue = { add: jest.fn().mockResolvedValue({}) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShareholderStatusService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'BullQueue_audience-sync', useValue: audienceQueue },
      ],
    }).compile();
    service = moduleRef.get(ShareholderStatusService);
  });

  it('recomputes, writes, and enqueues when the status changes', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.PENDING,
      registrations: [{ type: 'BUY', status: 'COMPLETED', quantity: 10 }],
    });

    await expect(service.recompute('sh1')).resolves.toBe(ShareholderStatus.ACTIVE);
    expect(prisma.shareholder.update).toHaveBeenCalledWith({
      where: { id: 'sh1' },
      data: { status: ShareholderStatus.ACTIVE },
    });
    expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', {
      coopId: 'coop1',
      shareholderId: 'sh1',
    });
  });

  it('does not write or enqueue when the status is unchanged', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.ACTIVE,
      registrations: [{ type: 'BUY', status: 'COMPLETED', quantity: 10 }],
    });

    await expect(service.recompute('sh1')).resolves.toBe(ShareholderStatus.ACTIVE);
    expect(prisma.shareholder.update).not.toHaveBeenCalled();
    expect(audienceQueue.add).not.toHaveBeenCalled();
  });

  it('returns null for an unknown shareholder', async () => {
    prisma.shareholder.findUnique.mockResolvedValue(null);

    await expect(service.recompute('missing')).resolves.toBeNull();
    expect(prisma.shareholder.update).not.toHaveBeenCalled();
    expect(audienceQueue.add).not.toHaveBeenCalled();
  });

  it('deduplicates shareholder ids in recomputeMany', async () => {
    const recompute = jest.spyOn(service, 'recompute').mockResolvedValue(ShareholderStatus.PENDING);

    await service.recomputeMany(['sh1', 'sh1', 'sh2', 'sh1', 'sh2']);

    expect(recompute).toHaveBeenCalledTimes(2);
    expect(recompute).toHaveBeenNthCalledWith(1, 'sh1');
    expect(recompute).toHaveBeenNthCalledWith(2, 'sh2');
  });

  it('returns the affected-row count from reconcileAll', async () => {
    prisma.$executeRaw.mockResolvedValue(4);

    await expect(service.reconcileAll()).resolves.toBe(4);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('swallows audience queue failures during recompute', async () => {
    prisma.shareholder.findUnique.mockResolvedValue({
      id: 'sh1',
      coopId: 'coop1',
      status: ShareholderStatus.PENDING,
      registrations: [{ type: 'BUY', status: 'COMPLETED', quantity: 10 }],
    });
    audienceQueue.add.mockRejectedValue(new Error('queue unavailable'));

    await expect(service.recompute('sh1')).resolves.toBe(ShareholderStatus.ACTIVE);
    expect(prisma.shareholder.update).toHaveBeenCalled();
  });
});
