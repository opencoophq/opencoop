jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

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
import { RegistrationsService } from '../registrations/registrations.service';
import { ShareTransferService } from '../registrations/share-transfer.service';
import { ShareholdersService } from './shareholders.service';

describeDb('ShareholdersService.findAll sharesOwned (database)', () => {
  let prisma: PrismaClient;
  let shareholders: ShareholdersService;
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
    shareholders = new ShareholdersService(prisma as any, new AuditService(prisma as any), {
      add: jest.fn(async () => undefined),
    } as any);
  });

  afterAll(async () => {
    await cleanupTestCoops(prisma);
    await prisma.$disconnect();
  });

  async function buy(
    coopId: string,
    shareholderId: string,
    shareClassId: string,
    quantity: number,
    paid: number,
    status: 'ACTIVE' | 'COMPLETED' = 'COMPLETED',
  ) {
    const reg = await prisma.registration.create({
      data: {
        coopId,
        shareholderId,
        shareClassId,
        type: 'BUY',
        status,
        quantity,
        pricePerShare: 10,
        totalAmount: quantity * 10,
        registerDate: new Date('2020-01-01T10:00:00Z'),
      },
    });
    if (paid > 0) {
      await prisma.payment.create({
        data: { coopId, registrationId: reg.id, amount: paid, bankDate: new Date('2020-01-02') },
      });
    }
    return reg;
  }

  async function listed(coopId: string) {
    const result = await shareholders.findAll(coopId, { pageSize: 100 });
    return new Map(result.items.map((i) => [i.id, i.sharesOwned]));
  }

  async function detailTotal(id: string, coopId: string) {
    const detail = await shareholders.findById(id, coopId);
    return (detail.registrations as Array<{ type: string; status: string; sharesOwned?: number }>)
      .filter((r) => r.type === 'BUY' && (r.status === 'ACTIVE' || r.status === 'COMPLETED'))
      .reduce((sum, r) => sum + (r.sharesOwned ?? 0), 0);
  }

  it('nets transfer SELLs, normal SELLs and unpaid shares, and matches findById', async () => {
    const coop = await createTestCoop(prisma);
    const shareClass = await createTestShareClass(prisma, coop.id);
    const deceased = await createTestShareholder(prisma, coop.id);
    const heir = await createTestShareholder(prisma, coop.id);
    const seller = await createTestShareholder(prisma, coop.id);
    const saver = await createTestShareholder(prisma, coop.id);

    await buy(coop.id, deceased.id, shareClass.id, 1, 10);
    await transfers.transferShares({
      coopId: coop.id,
      fromShareholderId: deceased.id,
      toShareholderId: heir.id,
      shareClassId: shareClass.id,
      quantity: 1,
      transferDate: '2026-03-01',
      reason: 'INHERITANCE',
    });

    const sold = await buy(coop.id, seller.id, shareClass.id, 10, 100);
    await registrations.createSell({
      coopId: coop.id,
      shareholderId: seller.id,
      registrationId: sold.id,
      quantity: 3,
    });

    // 4 shares, EUR 25 of EUR 40 paid → 2 vested.
    await buy(coop.id, saver.id, shareClass.id, 4, 25, 'ACTIVE');

    const owned = await listed(coop.id);
    expect(owned.get(deceased.id)).toBe(0);
    expect(owned.get(heir.id)).toBe(1);
    expect(owned.get(seller.id)).toBe(7);
    expect(owned.get(saver.id)).toBe(2);
    for (const sh of [deceased, heir, seller, saver]) {
      expect(owned.get(sh.id)).toBe(await detailTotal(sh.id, coop.id));
    }
  });
});
