import { ChargeCardSyncService } from './charge-card-sync.service';

function makePrisma() {
  const prisma: any = {
    chargeCard: {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    payment: { count: jest.fn().mockResolvedValue(0) },
    // SELECT ... FOR UPDATE on the card row (lockCard).
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'card-9', status: 'REQUESTED' }]),
    $transaction: jest.fn((arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma))),
  };
  return prisma;
}

describe('ChargeCardSyncService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ChargeCardSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ChargeCardSyncService(prisma);
  });

  it('blocks and unblocks in one transaction, and cancels a payment-free REQUESTED card', async () => {
    prisma.chargeCard.updateMany
      .mockResolvedValueOnce({ count: 2 }) // block
      .mockResolvedValueOnce({ count: 1 }) // unblock
      .mockResolvedValueOnce({ count: 1 }); // cancelCard's internal updateMany
    prisma.chargeCard.findMany.mockResolvedValue([{ id: 'card-9', shareholderId: 'sh-9' }]);
    prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-9' });
    prisma.chargeCard.findUniqueOrThrow.mockResolvedValue({ id: 'card-9', status: 'CANCELLED' });

    await expect(service.syncAll()).resolves.toEqual({ blocked: 2, unblocked: 1, cancelled: 1 });

    const [block, unblock] = prisma.chargeCard.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(block).toEqual({
      where: { status: 'ACTIVE', shareholder: { status: { not: 'ACTIVE' } } },
      data: { status: 'BLOCKED', blockReason: 'NO_SHARES', blockedAt: expect.any(Date), providerSyncNeeded: true },
    });
    expect(unblock).toEqual({
      where: { status: 'BLOCKED', blockReason: 'NO_SHARES', shareholder: { status: 'ACTIVE' } },
      data: { status: 'ACTIVE', blockReason: null, blockedAt: null, activatedAt: expect.any(Date), providerSyncNeeded: true },
    });

    expect(prisma.chargeCard.findMany).toHaveBeenCalledWith({
      where: { status: 'REQUESTED', shareholder: { status: { not: 'ACTIVE' } } },
      select: { id: true, shareholderId: true },
    });
    // The cancel goes through the shared lockCard/cancelCard path, not a bulk updateMany.
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.payment.count).toHaveBeenCalledWith({ where: { chargeCardId: 'card-9' } });
    const cancelCall = prisma.chargeCard.updateMany.mock.calls[2][0];
    expect(cancelCall).toEqual({
      where: { AND: [{ id: 'card-9' }, { status: { in: ['REQUESTED'] } }] },
      data: { status: 'CANCELLED', replacesCardId: null },
    });
  });

  it('scopes every statement to one shareholder', async () => {
    prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });

    await service.syncShareholder('sh-1');

    const [block, unblock] = prisma.chargeCard.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(block.where.shareholderId).toBe('sh-1');
    expect(unblock.where.shareholderId).toBe('sh-1');
    expect(prisma.chargeCard.findMany).toHaveBeenCalledWith({
      where: { shareholderId: 'sh-1', status: 'REQUESTED', shareholder: { status: { not: 'ACTIVE' } } },
      select: { id: true, shareholderId: true },
    });
  });

  it('leaves a REQUESTED card that already holds a payment, and logs a warning instead of cancelling it', async () => {
    prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });
    prisma.chargeCard.findMany.mockResolvedValue([{ id: 'card-9', shareholderId: 'sh-9' }]);
    prisma.payment.count.mockResolvedValue(1);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(service.syncAll()).resolves.toEqual({ blocked: 0, unblocked: 0, cancelled: 0 });

    // Only the block and unblock updateMany calls happened; no cancel updateMany was issued.
    expect(prisma.chargeCard.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.chargeCard.findFirst).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('card-9'));
  });

  it('does not cancel a candidate whose locked status is no longer REQUESTED', async () => {
    prisma.chargeCard.updateMany.mockResolvedValue({ count: 0 });
    prisma.chargeCard.findMany.mockResolvedValue([{ id: 'card-9', shareholderId: 'sh-9' }]);
    prisma.$queryRaw.mockResolvedValue([{ id: 'card-9', status: 'PAID' }]);

    await expect(service.syncAll()).resolves.toEqual({ blocked: 0, unblocked: 0, cancelled: 0 });
    expect(prisma.payment.count).not.toHaveBeenCalled();
    expect(prisma.chargeCard.findFirst).not.toHaveBeenCalled();
  });

  it('keeps processing the other candidates when one candidate transaction throws', async () => {
    prisma.chargeCard.updateMany
      .mockResolvedValueOnce({ count: 0 }) // block
      .mockResolvedValueOnce({ count: 0 }) // unblock
      .mockResolvedValueOnce({ count: 1 }); // cancelCard's internal updateMany, for card-9
    prisma.chargeCard.findMany.mockResolvedValue([
      { id: 'card-bad', shareholderId: 'sh-bad' },
      { id: 'card-9', shareholderId: 'sh-9' },
    ]);
    prisma.chargeCard.findFirst.mockResolvedValue({ id: 'card-9' });
    prisma.chargeCard.findUniqueOrThrow.mockResolvedValue({ id: 'card-9', status: 'CANCELLED' });
    prisma.$queryRaw.mockImplementation((_strings: unknown, ...values: string[]) => {
      const [id] = values;
      if (id === 'card-bad') {
        return Promise.reject(new Error('lock timeout'));
      }
      return Promise.resolve([{ id, status: 'REQUESTED' }]);
    });
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await expect(service.syncAll()).resolves.toEqual({ blocked: 0, unblocked: 0, cancelled: 1 });

    // The failing candidate's lock threw, but card-9 still got cancelled.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('card-bad'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lock timeout'));
    // The summary log always prints and carries the failed count.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 failed'));
  });
});
