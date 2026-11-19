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
import { RegistrationsService } from './registrations.service';
import { ShareTransferService } from './share-transfer.service';

describeDb('createSell / createTransfer row locks (database)', () => {
  let prisma: PrismaClient;
  let registrations: RegistrationsService;
  let transfers: ShareTransferService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await cleanupTestCoops(prisma);
    const status = { recomputeMany: jest.fn(async () => undefined) } as any;
    const notifications = { notifyAdminsOnEvent: jest.fn(async () => undefined) } as any;
    registrations = new RegistrationsService(
      prisma as any,
      {} as any,
      {} as any,
      notifications,
      status,
      {} as any,
    );
    transfers = new ShareTransferService(
      prisma as any,
      registrations,
      status,
      new AuditService(prisma as any),
    );
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  /** One shareholder with one fully paid BUY of 4 shares at EUR 10. */
  async function setup() {
    const coop = await createTestCoop(prisma);
    const owner = await createTestShareholder(prisma, coop.id);
    const other = await createTestShareholder(prisma, coop.id);
    const shareClass = await createTestShareClass(prisma, coop.id);
    const buy = await prisma.registration.create({
      data: {
        coopId: coop.id,
        shareholderId: owner.id,
        shareClassId: shareClass.id,
        type: 'BUY',
        status: 'COMPLETED',
        quantity: 4,
        pricePerShare: 10,
        totalAmount: 40,
        registerDate: new Date('2019-01-01T10:00:00Z'),
      },
    });
    await prisma.payment.create({
      data: {
        coopId: coop.id,
        registrationId: buy.id,
        amount: 40,
        bankDate: new Date('2019-01-01T10:00:00Z'),
      },
    });
    return { coop, owner, other, shareClass, buy };
  }

  async function committedSold(buyId: string) {
    const sold = await prisma.registration.aggregate({
      where: {
        sellsRegistrationId: buyId,
        type: 'SELL',
        status: { in: ['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      _sum: { quantity: true },
    });
    return sold._sum.quantity ?? 0;
  }

  function expectOneWinner(results: PromiseSettledResult<unknown>[]) {
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
  }

  it('lets only one of two concurrent createSell calls sell the same shares', async () => {
    const { coop, owner, buy } = await setup();
    const sell = () =>
      registrations.createSell({
        coopId: coop.id,
        shareholderId: owner.id,
        registrationId: buy.id,
        quantity: 3,
      });

    expectOneWinner(await Promise.allSettled([sell(), sell()]));
    expect(await committedSold(buy.id)).toBe(3);
  });

  it('does not oversell when createSell races transferShares on the same shares', async () => {
    const { coop, owner, other, shareClass, buy } = await setup();

    const results = await Promise.allSettled([
      registrations.createSell({
        coopId: coop.id,
        shareholderId: owner.id,
        registrationId: buy.id,
        quantity: 3,
      }),
      transfers.transferShares({
        coopId: coop.id,
        fromShareholderId: owner.id,
        toShareholderId: other.id,
        shareClassId: shareClass.id,
        quantity: 3,
        transferDate: '2026-03-01',
        reason: 'SALE',
      }),
    ]);

    expectOneWinner(results);
    expect(await committedSold(buy.id)).toBe(3);
  });

  it('does not oversell when createTransfer races createSell on the same buy', async () => {
    const { coop, owner, other, buy } = await setup();

    const results = await Promise.allSettled([
      registrations.createTransfer({
        coopId: coop.id,
        fromShareholderId: owner.id,
        toShareholderId: other.id,
        registrationId: buy.id,
        quantity: 3,
      }),
      registrations.createSell({
        coopId: coop.id,
        shareholderId: owner.id,
        registrationId: buy.id,
        quantity: 3,
      }),
    ]);

    expectOneWinner(results);
    expect(await committedSold(buy.id)).toBe(3);
  });
});
