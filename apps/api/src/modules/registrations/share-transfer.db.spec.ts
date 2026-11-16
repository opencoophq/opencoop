jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@opencoop/database';
import {
  cleanupTestCoops,
  createTestCoop,
  createTestPrisma,
  createTestShareClass,
  createTestShareholder,
  describeDb,
} from '../../test-utils/test-db';
import { AuditService } from '../audit/audit.service';
import { DividendsService } from '../dividends/dividends.service';
import { RegistrationsService } from './registrations.service';
import { ShareTransferService } from './share-transfer.service';

describeDb('ShareTransferService (database)', () => {
  let prisma: PrismaClient;
  let service: ShareTransferService;
  const recomputeMany = jest.fn(async () => undefined);

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
    const status = { recomputeMany } as any;
    const registrations = new RegistrationsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      status,
      {} as any,
    );
    service = new ShareTransferService(
      prisma as any,
      registrations,
      status,
      new AuditService(prisma as any),
    );
  });

  afterAll(async () => {
    await prisma.shareTransfer.deleteMany({ where: { coop: { slug: { startsWith: 'dbtest-' } } } });
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  async function setup(
    buys: Array<{ quantity: number; price: number; date: string; paidOn?: string }>,
  ) {
    const coop = await createTestCoop(prisma);
    const from = await createTestShareholder(prisma, coop.id);
    const to = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    for (const buy of buys) {
      const reg = await prisma.registration.create({
        data: {
          coopId: coop.id,
          shareholderId: from.id,
          shareClassId: shareClass.id,
          type: 'BUY',
          status: 'COMPLETED',
          quantity: buy.quantity,
          pricePerShare: buy.price,
          totalAmount: buy.quantity * buy.price,
          registerDate: new Date(buy.date),
        },
      });
      await prisma.payment.create({
        data: {
          coopId: coop.id,
          registrationId: reg.id,
          amount: buy.quantity * buy.price,
          bankDate: new Date(buy.paidOn ?? buy.date),
        },
      });
    }
    return { coop, from, to, shareClass };
  }

  async function capital(coopId: string) {
    const payments = await prisma.payment.findMany({
      where: { coopId },
      select: { amount: true, registration: { select: { type: true } } },
    });
    return payments.reduce(
      (sum, p) => sum + (p.registration?.type === 'SELL' ? -1 : 1) * Number(p.amount),
      0,
    );
  }

  it('writes linked rows FIFO, keeps capital, and marks the source deceased', async () => {
    const { coop, from, to, shareClass } = await setup([
      { quantity: 3, price: 10, date: '2019-01-01T10:00:00Z' },
      { quantity: 2, price: 12, date: '2021-01-01T10:00:00Z' },
    ]);
    const before = await capital(coop.id);

    const result = await service.transferShares({
      coopId: coop.id,
      fromShareholderId: from.id,
      toShareholderId: to.id,
      shareClassId: shareClass.id,
      quantity: 5,
      transferDate: '2026-03-01',
      reason: 'INHERITANCE',
    });

    expect(result.valueEur).toBe(54);
    expect(result.registrations).toHaveLength(4);
    const rows = await prisma.registration.findMany({
      where: { shareTransferId: result.transfer.id },
    });
    expect(rows).toHaveLength(4);
    expect(await capital(coop.id)).toBe(before);
    const source = await prisma.shareholder.findUniqueOrThrow({ where: { id: from.id } });
    expect(source.deceasedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    const audit = await prisma.auditLog.findMany({ where: { coopId: coop.id } });
    expect(audit.map((a) => a.entity).sort()).toEqual(['ShareTransfer', 'Shareholder']);

    const replay = await service.transferShares({
      coopId: coop.id,
      fromShareholderId: from.id,
      toShareholderId: to.id,
      shareClassId: shareClass.id,
      quantity: 5,
      transferDate: '2026-03-01',
      reason: 'INHERITANCE',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(await prisma.shareTransfer.count({ where: { coopId: coop.id } })).toBe(1);
  });

  it('lets only one of two concurrent transfers consume the same shares', async () => {
    const { coop, from, to, shareClass } = await setup([
      { quantity: 4, price: 10, date: '2019-01-01T10:00:00Z' },
    ]);
    const input = (key: string) => ({
      coopId: coop.id,
      fromShareholderId: from.id,
      toShareholderId: to.id,
      shareClassId: shareClass.id,
      quantity: 3,
      transferDate: '2026-03-01',
      reason: 'SALE' as const,
      idempotencyKey: key,
    });

    const results = await Promise.allSettled([
      service.transferShares(input('concurrent-a')),
      service.transferShares(input('concurrent-b')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
    const sold = await prisma.registration.aggregate({
      where: { shareholderId: from.id, type: 'SELL' },
      _sum: { quantity: true },
    });
    expect(sold._sum.quantity).toBe(3);
  });

  it('collapses two concurrent identical submits into one transfer', async () => {
    const { coop, from, to, shareClass } = await setup([
      { quantity: 4, price: 10, date: '2019-01-01T10:00:00Z' },
    ]);
    const input = {
      coopId: coop.id,
      fromShareholderId: from.id,
      toShareholderId: to.id,
      shareClassId: shareClass.id,
      quantity: 2,
      transferDate: '2026-03-01',
      reason: 'GIFT' as const,
    };

    const [a, b] = await Promise.all([
      service.transferShares(input),
      service.transferShares(input),
    ]);

    expect(a.transfer.id).toBe(b.transfer.id);
    expect([a.idempotentReplay, b.idempotentReplay].sort()).toEqual([false, true]);
    expect(await prisma.shareTransfer.count({ where: { coopId: coop.id } })).toBe(1);
  });

  it('refuses shares registered before but paid after the transfer date', async () => {
    const { coop, from, to, shareClass } = await setup([
      { quantity: 4, price: 10, date: '2026-01-10T10:00:00Z', paidOn: '2026-03-05T00:00:00Z' },
    ]);

    await expect(
      service.transferShares({
        coopId: coop.id,
        fromShareholderId: from.id,
        toShareholderId: to.id,
        shareClassId: shareClass.id,
        quantity: 1,
        transferDate: '2026-03-02',
        reason: 'INHERITANCE',
      }),
    ).rejects.toThrow(/holds 0 available/);
    expect(await prisma.shareTransfer.count({ where: { coopId: coop.id } })).toBe(0);
  });

  it.each([
    ['before', '2026-02-28', 'from'],
    ['equal to', '2026-03-01', 'from'],
    ['after', '2026-03-02', 'to'],
  ] as const)(
    'pays the dividend to exactly one party when the ex-dividend date is %s the transfer date',
    async (_label, exDividendDate, payee) => {
      const { coop, from, to, shareClass } = await setup([
        { quantity: 4, price: 10, date: '2019-01-01T10:00:00Z' },
      ]);
      // A backdated inheritance, recorded with a date-time late on 28 Feb UTC (1 March in Brussels).
      await service.transferShares({
        coopId: coop.id,
        fromShareholderId: from.id,
        toShareholderId: to.id,
        shareClassId: shareClass.id,
        quantity: 4,
        transferDate: '2026-02-28T23:30:00Z',
        reason: 'INHERITANCE',
      });
      const period = await prisma.dividendPeriod.create({
        data: {
          coopId: coop.id,
          year: 2026,
          dividendRate: 0.05,
          exDividendDate: new Date(exDividendDate),
        },
      });
      const dividends = new DividendsService(prisma as any, new AuditService(prisma as any));

      await dividends.calculate(period.id, coop.id);

      const payouts = await prisma.dividendPayout.findMany({
        where: { dividendPeriodId: period.id },
      });
      expect(payouts.map((p) => p.shareholderId)).toEqual([payee === 'from' ? from.id : to.id]);
      // 4 shares x EUR 10 x 5% = EUR 2 gross, paid once.
      expect(Number(payouts[0].grossAmount)).toBe(2);
    },
  );
});
