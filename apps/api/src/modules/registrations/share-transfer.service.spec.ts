// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock the whole module
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@opencoop/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { EmailService } from '../email/email.service';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { ShareholderStatusService } from '../shareholder-status/shareholder-status.service';
import { OgmService } from '../ogm/ogm.service';
import { RegistrationsService } from './registrations.service';
import { ShareTransferService, TransferSharesInput } from './share-transfer.service';

/**
 * In-memory stand-in for the Prisma calls ShareTransferService and the
 * RegistrationsService helpers it reuses make. Writes land in arrays, so a test can
 * check both what was written and that nothing was.
 */
type Reg = {
  id: string;
  coopId: string;
  shareholderId: string;
  shareClassId: string;
  projectId: string | null;
  type: 'BUY' | 'SELL';
  status: string;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  registerDate: Date;
  processedAt?: Date | null;
  createdAt: Date;
  sellsRegistrationId?: string | null;
  fromShareholderId?: string | null;
  toShareholderId?: string | null;
  shareTransferId?: string | null;
  processedByUserId?: string | null;
};
type Pay = { id: string; registrationId: string; coopId: string; amount: number; bankDate: Date };
type Sh = {
  id: string;
  coopId: string;
  type: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  status: string;
  deceasedAt: Date | null;
  isEcoPowerClient: boolean;
};

function makeDb() {
  const state = {
    shareholders: [] as Sh[],
    shareClasses: [
      { id: 'class-a', coopId: 'coop-1', name: 'Aandeel A', code: 'A', pricePerShare: 250 },
    ],
    registrations: [] as Reg[],
    payments: [] as Pay[],
    transfers: [] as any[],
    audit: [] as any[],
    coop: {
      ecoPowerEnabled: false,
      ecoPowerMinThresholdType: null as string | null,
      ecoPowerMinThreshold: null as number | null,
    },
  };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const withPayments = (r: Reg) => ({
    ...r,
    payments: state.payments
      .filter((p) => p.registrationId === r.id)
      .map((p) => ({ amount: p.amount })),
  });
  const statusIn = (where: any, r: Reg) => !where.status?.in || where.status.in.includes(r.status);

  const db: any = {
    state,
    $transaction: jest.fn((cb: any) => cb(db)),
    $queryRaw: jest.fn(async () => []),
    shareholder: {
      findFirst: jest.fn(async ({ where }: any) => {
        const sh = state.shareholders.find((s) => s.id === where.id && s.coopId === where.coopId);
        if (!sh) return null;
        return {
          ...sh,
          registrations: state.registrations
            .filter((r) => r.shareholderId === sh.id)
            .map(withPayments),
        };
      }),
      findUnique: jest.fn(
        async ({ where }: any) => state.shareholders.find((s) => s.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        state.shareholders.filter((s) => where.id.in.includes(s.id)),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const sh = state.shareholders.find((s) => s.id === where.id)!;
        Object.assign(sh, data);
        return sh;
      }),
    },
    shareClass: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          state.shareClasses.find((c) => c.id === where.id && c.coopId === where.coopId) ?? null,
      ),
    },
    coop: { findUnique: jest.fn(async () => state.coop) },
    registration: {
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        let rows = state.registrations.filter((r) => {
          if (where.shareTransferId) return r.shareTransferId === where.shareTransferId;
          if (where.coopId && r.coopId !== where.coopId) return false;
          if (where.shareholderId && r.shareholderId !== where.shareholderId) return false;
          if (where.shareClassId && r.shareClassId !== where.shareClassId) return false;
          if (where.type && r.type !== where.type) return false;
          if (!statusIn(where, r)) return false;
          if (where.OR) {
            return where.OR.some((c: any) => c.type === r.type && c.status.in.includes(r.status));
          }
          return true;
        });
        if (orderBy) {
          rows = [...rows].sort(
            (a, b) =>
              a.registerDate.getTime() - b.registerDate.getTime() || a.id.localeCompare(b.id),
          );
        }
        return rows.map(withPayments);
      }),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: {
          quantity:
            state.registrations
              .filter(
                (r) =>
                  r.sellsRegistrationId === where.sellsRegistrationId &&
                  r.type === where.type &&
                  statusIn(where, r),
              )
              .reduce((s, r) => s + r.quantity, 0) || null,
        },
      })),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('reg'), createdAt: new Date(), ...data };
        state.registrations.push(row);
        return row;
      }),
    },
    payment: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: id('pay'), ...data };
        state.payments.push(row);
        return row;
      }),
    },
    shareTransfer: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.coopId_idempotencyKey;
        return (
          state.transfers.find(
            (t) => t.coopId === k.coopId && t.idempotencyKey === k.idempotencyKey,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: id('transfer'),
          markedFromAsDeceased: false,
          createdAt: new Date(),
          ...data,
        };
        state.transfers.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.transfers.find((t) => t.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        state.audit.push(data);
        return data;
      }),
    },
  };

  const addShareholder = (s: Partial<Sh> & { id: string }) => {
    state.shareholders.push({
      coopId: 'coop-1',
      type: 'INDIVIDUAL',
      firstName: null,
      lastName: null,
      companyName: null,
      status: 'ACTIVE',
      deceasedAt: null,
      isEcoPowerClient: false,
      ...s,
    });
  };
  const addPaidBuy = (
    shareholderId: string,
    quantity: number,
    registerDate: string,
    price = 250,
    regId?: string,
  ) => {
    const row: Reg = {
      id: regId ?? id('buy'),
      coopId: 'coop-1',
      shareholderId,
      shareClassId: 'class-a',
      projectId: 'project-1',
      type: 'BUY',
      status: 'COMPLETED',
      quantity,
      pricePerShare: price,
      totalAmount: quantity * price,
      registerDate: new Date(registerDate),
      createdAt: new Date(registerDate),
    };
    state.registrations.push(row);
    state.payments.push({
      id: id('pay'),
      registrationId: row.id,
      coopId: 'coop-1',
      amount: quantity * price,
      bankDate: new Date(registerDate),
    });
    return row;
  };

  return { db, state, addShareholder, addPaidBuy };
}

describe('ShareTransferService', () => {
  let service: ShareTransferService;
  let fake: ReturnType<typeof makeDb>;
  let shareholderStatus: { recompute: jest.Mock; recomputeMany: jest.Mock };

  const writeMocks = () => [
    fake.db.registration.create,
    fake.db.payment.create,
    fake.db.shareTransfer.create,
    fake.db.shareTransfer.update,
    fake.db.shareholder.update,
    fake.db.auditLog.create,
  ];
  const expectNoWrites = () => {
    for (const m of writeMocks()) expect(m).not.toHaveBeenCalled();
  };

  const base = (overrides: Partial<TransferSharesInput> = {}): TransferSharesInput => ({
    coopId: 'coop-1',
    fromShareholderId: 'alice',
    toShareholderId: 'bob',
    shareClassId: 'class-a',
    quantity: 4,
    transferDate: '2026-03-01',
    reason: 'INHERITANCE',
    processedByUserId: 'admin-1',
    ...overrides,
  });

  beforeEach(async () => {
    fake = makeDb();
    fake.addShareholder({ id: 'alice', firstName: 'Alice', lastName: 'Testperson' });
    fake.addShareholder({ id: 'bob', firstName: 'Bob', lastName: 'Testperson' });
    fake.addShareholder({
      id: 'carol-other-coop',
      coopId: 'coop-2',
      firstName: 'Carol',
      lastName: 'Testperson',
    });
    shareholderStatus = {
      recompute: jest.fn().mockResolvedValue(null),
      recomputeMany: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ShareTransferService,
        RegistrationsService,
        AuditService,
        { provide: PrismaService, useValue: fake.db },
        { provide: EmailService, useValue: {} },
        { provide: DocumentsService, useValue: {} },
        { provide: AdminNotificationsService, useValue: {} },
        { provide: ShareholderStatusService, useValue: shareholderStatus },
        { provide: OgmService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ShareTransferService);
  });

  describe('transferShares', () => {
    it('moves an inheritance into a recipient who already holds the class', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z', 250, 'alice-buy');
      fake.addPaidBuy('bob', 2, '2021-05-01T10:00:00Z', 250, 'bob-buy');

      const result = await service.transferShares(base({ note: 'Erfopvolging na overlijden' }));

      expect(result.idempotentReplay).toBe(false);
      expect(result.valueEur).toBe(1000);
      const rows = fake.state.registrations.filter((r) => r.shareTransferId === result.transfer.id);
      expect(rows).toHaveLength(2);
      const sell = rows.find((r) => r.type === 'SELL')!;
      const buy = rows.find((r) => r.type === 'BUY')!;
      expect(sell).toMatchObject({
        shareholderId: 'alice',
        status: 'COMPLETED',
        quantity: 4,
        pricePerShare: 250,
        totalAmount: 1000,
        sellsRegistrationId: 'alice-buy',
        toShareholderId: 'bob',
        projectId: 'project-1',
        processedByUserId: 'admin-1',
      });
      expect(buy).toMatchObject({
        shareholderId: 'bob',
        status: 'COMPLETED',
        quantity: 4,
        fromShareholderId: 'alice',
        projectId: 'project-1',
      });
      expect(sell.registerDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(buy.registerDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      // Dividends subtract a SELL by processedAt and count a BUY by bankDate.
      // Both must be the transfer date, or a backdated transfer pays twice.
      expect(sell.processedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(buy.processedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(result.registrations).toEqual([sell.id, buy.id]);
      expect(result.transfer).toMatchObject({
        reason: 'INHERITANCE',
        quantity: 4,
        totalAmount: 1000,
        note: 'Erfopvolging na overlijden',
        markedFromAsDeceased: true,
      });

      const alice = fake.state.shareholders.find((s) => s.id === 'alice')!;
      expect(alice.deceasedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(result.from.deceasedAt).toEqual(alice.deceasedAt);
    });

    it('uses dateOfDeath for deceasedAt when given', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      await service.transferShares(base({ dateOfDeath: '2026-01-15', markFromAsDeceased: true }));

      const alice = fake.state.shareholders.find((s) => s.id === 'alice')!;
      expect(alice.deceasedAt?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });

    it('allocates FIFO across two source buys and copies each buy price', async () => {
      fake.addPaidBuy('alice', 3, '2019-01-01T10:00:00Z', 100, 'old-buy');
      fake.addPaidBuy('alice', 5, '2022-01-01T10:00:00Z', 250, 'new-buy');

      const result = await service.transferShares(base({ quantity: 5 }));

      const sells = fake.state.registrations.filter((r) => r.type === 'SELL');
      expect(sells.map((s) => [s.sellsRegistrationId, s.quantity, s.pricePerShare])).toEqual([
        ['old-buy', 3, 100],
        ['new-buy', 2, 250],
      ]);
      expect(result.valueEur).toBe(800);
      expect(result.transfer.totalAmount).toBe(800);
      // 3 shares stay with Alice, so she is not marked deceased without the flag.
      expect(result.transfer.markedFromAsDeceased).toBe(false);
      expect(fake.state.shareholders.find((s) => s.id === 'alice')!.deceasedAt).toBeNull();
    });

    it('ignores buys registered after the transfer date', async () => {
      fake.addPaidBuy('alice', 2, '2019-01-01T10:00:00Z');
      fake.addPaidBuy('alice', 5, '2026-04-01T10:00:00Z');

      await expect(service.transferShares(base({ quantity: 3 }))).rejects.toThrow(
        /Not enough shares: the source holds 2 available/,
      );
    });

    it('rejects a transfer of more shares than the source holds, and writes nothing', async () => {
      fake.addPaidBuy('alice', 2, '2020-01-10T10:00:00Z');

      await expect(service.transferShares(base({ quantity: 3 }))).rejects.toThrow(
        BadRequestException,
      );
      expectNoWrites();
    });

    it('counts earlier sells against availability', async () => {
      const buy = fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      fake.state.registrations.push({
        ...buy,
        id: 'earlier-sell',
        type: 'SELL',
        status: 'PENDING',
        quantity: 3,
        sellsRegistrationId: buy.id,
      });

      await expect(service.transferShares(base({ quantity: 2 }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('treats a shareholder from another coop as not found, and writes nothing', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      await expect(
        service.transferShares(base({ toShareholderId: 'carol-other-coop' })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.transferShares(base({ fromShareholderId: 'carol-other-coop' })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.transferShares(base({ shareClassId: 'class-elsewhere' })),
      ).rejects.toThrow(NotFoundException);
      expectNoWrites();
    });

    it('rejects a transfer to the same shareholder', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      await expect(service.transferShares(base({ toShareholderId: 'alice' }))).rejects.toThrow(
        /must be different shareholders/,
      );
      expectNoWrites();
    });

    it.each([0, -1, 1.5])('rejects quantity %p', async (quantity) => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      await expect(service.transferShares(base({ quantity }))).rejects.toThrow(
        /quantity must be a whole number greater than 0/,
      );
      expectNoWrites();
    });

    it('rejects a future transfer date and an invalid one', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

      await expect(service.transferShares(base({ transferDate: tomorrow }))).rejects.toThrow(
        /transferDate cannot be in the future/,
      );
      await expect(service.transferShares(base({ transferDate: '2026-02-31' }))).rejects.toThrow(
        /transferDate is not a valid date/,
      );
      expectNoWrites();
    });

    it('accepts today as the transfer date', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(
        new Date(),
      );

      const result = await service.transferShares(base({ transferDate: today }));

      expect(result.idempotentReplay).toBe(false);
    });

    it('rejects a deceased recipient', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      fake.state.shareholders.find((s) => s.id === 'bob')!.deceasedAt = new Date('2025-01-01');

      await expect(service.transferShares(base())).rejects.toThrow(
        /recipient is recorded as deceased/,
      );
      expectNoWrites();
    });

    it.each(['SALE', 'GIFT', 'OTHER'] as const)(
      'rejects markFromAsDeceased and dateOfDeath with reason %s',
      async (reason) => {
        fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

        await expect(
          service.transferShares(base({ reason, markFromAsDeceased: true })),
        ).rejects.toThrow(/markFromAsDeceased is only allowed with reason INHERITANCE/);
        await expect(
          service.transferShares(base({ reason, dateOfDeath: '2026-01-01' })),
        ).rejects.toThrow(/dateOfDeath is only allowed with reason INHERITANCE/);
        expectNoWrites();
      },
    );

    it('rejects a dateOfDeath after the transfer date', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      await expect(service.transferShares(base({ dateOfDeath: '2026-03-02' }))).rejects.toThrow(
        /dateOfDeath cannot be after transferDate/,
      );
    });

    it('marks the source deceased when no shares remain, even without the flag, and recomputes status', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      const result = await service.transferShares(base({ markFromAsDeceased: undefined }));

      expect(result.transfer.markedFromAsDeceased).toBe(true);
      expect(fake.state.shareholders.find((s) => s.id === 'alice')!.deceasedAt).not.toBeNull();
      expect(shareholderStatus.recomputeMany).toHaveBeenCalledWith(['alice', 'bob']);
    });

    it('does not mark the source deceased for a SALE that empties the holding', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      const result = await service.transferShares(base({ reason: 'SALE' }));

      expect(result.transfer.markedFromAsDeceased).toBe(false);
      expect(fake.state.shareholders.find((s) => s.id === 'alice')!.deceasedAt).toBeNull();
    });

    it('keeps the coop capital unchanged', async () => {
      fake.addPaidBuy('alice', 3, '2019-01-01T10:00:00Z', 100);
      fake.addPaidBuy('alice', 5, '2022-01-01T10:00:00Z', 250);
      const paid = (type: 'BUY' | 'SELL') =>
        fake.state.payments
          .filter(
            (p) => fake.state.registrations.find((r) => r.id === p.registrationId)?.type === type,
          )
          .reduce((s, p) => s + p.amount, 0);
      const capital = () => paid('BUY') - paid('SELL');
      const before = capital();

      const result = await service.transferShares(base({ quantity: 6 }));

      const rows = fake.state.registrations.filter((r) => r.shareTransferId === result.transfer.id);
      const total = (type: 'BUY' | 'SELL') =>
        rows.filter((r) => r.type === type).reduce((s, r) => s + r.totalAmount, 0);
      expect(total('SELL')).toBe(total('BUY'));
      expect(total('SELL')).toBe(result.valueEur);
      const newPayments = fake.state.payments.filter((p) =>
        rows.some((r) => r.id === p.registrationId),
      );
      for (const row of rows) {
        const pay = newPayments.filter((p) => p.registrationId === row.id);
        expect(pay).toHaveLength(1);
        expect(pay[0].amount).toBe(row.totalAmount);
        expect(pay[0].bankDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      }
      expect(capital()).toBe(before);
    });

    it('writes audit rows for the transfer and the death date, in the transaction', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');

      const result = await service.transferShares(base({ note: 'Testament' }));

      expect(fake.state.audit).toHaveLength(2);
      const [transferRow, shareholderRow] = fake.state.audit;
      expect(transferRow).toMatchObject({
        coopId: 'coop-1',
        entity: 'ShareTransfer',
        entityId: result.transfer.id,
        action: 'CREATE',
        actorId: 'admin-1',
      });
      expect(transferRow.changes).toEqual(
        expect.arrayContaining([
          { field: 'fromShareholderId', oldValue: null, newValue: 'alice' },
          { field: 'toShareholderId', oldValue: null, newValue: 'bob' },
          { field: 'shareClassId', oldValue: null, newValue: 'class-a' },
          { field: 'quantity', oldValue: null, newValue: 4 },
          { field: 'totalAmount', oldValue: null, newValue: 1000 },
          { field: 'transferDate', oldValue: null, newValue: '2026-03-01' },
          { field: 'reason', oldValue: null, newValue: 'INHERITANCE' },
          { field: 'note', oldValue: null, newValue: 'Testament' },
        ]),
      );
      expect(shareholderRow).toMatchObject({
        entity: 'Shareholder',
        entityId: 'alice',
        action: 'UPDATE',
        changes: [{ field: 'deceasedAt', oldValue: null, newValue: '2026-03-01' }],
      });
      expect(fake.db.$transaction).toHaveBeenCalledTimes(1);
      expect(fake.db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('replays an idempotent repeat without writing anything', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      const first = await service.transferShares(base());
      for (const m of writeMocks()) m.mockClear();
      shareholderStatus.recomputeMany.mockClear();

      const second = await service.transferShares(base());

      expect(second.idempotentReplay).toBe(true);
      expect(second.transfer.id).toBe(first.transfer.id);
      expect(second.registrations).toEqual(first.registrations);
      expect(second.valueEur).toBe(1000);
      expectNoWrites();
      // A replay re-derives status in case the first call failed after commit.
      expect(shareholderStatus.recomputeMany).toHaveBeenCalledWith(['alice', 'bob']);
    });

    it('rejects a reused idempotency key with different parameters', async () => {
      fake.addPaidBuy('alice', 8, '2020-01-10T10:00:00Z');
      await service.transferShares(base({ idempotencyKey: 'key-1' }));
      for (const m of writeMocks()) m.mockClear();

      await expect(
        service.transferShares(base({ idempotencyKey: 'key-1', quantity: 2 })),
      ).rejects.toThrow(ConflictException);
      expectNoWrites();
    });

    it('returns the winning row when a concurrent submit hits the unique key', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      const winner = {
        ...base(),
        id: 'transfer-winner',
        transferDate: new Date('2026-03-01T00:00:00Z'),
        totalAmount: 1000,
        idempotencyKey: 'key-race',
      };
      fake.db.shareTransfer.findUnique
        .mockResolvedValueOnce(null) // fast path, before the transaction
        .mockResolvedValueOnce(null) // inside the transaction
        .mockResolvedValueOnce(winner); // after the P2002
      fake.db.shareTransfer.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['coopId', 'idempotencyKey'] },
        }),
      );

      const result = await service.transferShares(base({ idempotencyKey: 'key-race' }));

      expect(result.idempotentReplay).toBe(true);
      expect(result.transfer.id).toBe('transfer-winner');
    });

    it('skips the EcoPower minimum for an inheritance but applies it to a sale', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z');
      fake.state.shareholders.find((s) => s.id === 'alice')!.isEcoPowerClient = true;
      fake.state.coop = {
        ecoPowerEnabled: true,
        ecoPowerMinThresholdType: 'SHARES',
        ecoPowerMinThreshold: 1,
      };

      await expect(service.transferShares(base({ reason: 'SALE' }))).rejects.toThrow(/Ecopower/);
      expectNoWrites();

      const result = await service.transferShares(base({ reason: 'INHERITANCE' }));
      expect(result.idempotentReplay).toBe(false);
    });
  });

  describe('previewTransfer', () => {
    it('returns before/after figures and statuses without writing', async () => {
      fake.addPaidBuy('alice', 4, '2020-01-10T10:00:00Z', 250, 'alice-buy');
      fake.addPaidBuy('bob', 2, '2021-05-01T10:00:00Z');

      const preview = await service.previewTransfer(base());

      expect(preview).toMatchObject({
        valid: true,
        errors: [],
        quantity: 4,
        transferDate: '2026-03-01',
        valueEur: 1000,
        fromWillBeMarkedDeceased: true,
        shareClass: { id: 'class-a', name: 'Aandeel A', code: 'A', pricePerShare: 250 },
        allocations: [{ registrationId: 'alice-buy', quantity: 4, pricePerShare: 250 }],
        from: {
          id: 'alice',
          name: 'Alice Testperson',
          deceasedAt: null,
          before: { sharesInClass: 4, valueInClassEur: 1000, totalShares: 4, totalValueEur: 1000 },
          after: { sharesInClass: 0, valueInClassEur: 0, totalShares: 0, totalValueEur: 0 },
          statusBefore: 'ACTIVE',
          statusAfter: 'INACTIVE',
        },
        to: {
          id: 'bob',
          name: 'Bob Testperson',
          before: { sharesInClass: 2, totalShares: 2 },
          after: { sharesInClass: 6, valueInClassEur: 1500, totalShares: 6, totalValueEur: 1500 },
          statusAfter: 'ACTIVE',
        },
      });
      expectNoWrites();
      expect(fake.db.$transaction).not.toHaveBeenCalled();
    });

    it('lists every validation failure instead of throwing', async () => {
      fake.addPaidBuy('alice', 1, '2020-01-10T10:00:00Z');
      fake.state.shareholders.find((s) => s.id === 'bob')!.deceasedAt = new Date('2025-01-01');
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

      const preview = await service.previewTransfer(
        base({ reason: 'GIFT', markFromAsDeceased: true, transferDate: tomorrow, quantity: 5 }),
      );

      expect(preview.valid).toBe(false);
      expect(preview.errors).toEqual(
        expect.arrayContaining([
          'transferDate cannot be in the future',
          'markFromAsDeceased is only allowed with reason INHERITANCE',
          'The recipient is recorded as deceased',
          expect.stringMatching(/^Not enough shares/),
        ]),
      );
      expect(preview.valueEur).toBeNull();
      expect(preview.from?.before.sharesInClass).toBe(1);
      expect(preview.from?.after).toBeNull();
      expectNoWrites();
    });

    it('reports unknown and cross-coop parties as errors', async () => {
      const preview = await service.previewTransfer(
        base({ fromShareholderId: 'nobody', toShareholderId: 'carol-other-coop', quantity: 0 }),
      );

      expect(preview.valid).toBe(false);
      expect(preview.errors).toEqual(
        expect.arrayContaining([
          'Source shareholder not found',
          'Recipient shareholder not found',
          'quantity must be a whole number greater than 0',
        ]),
      );
      expect(preview.from).toBeNull();
      expect(preview.to).toBeNull();
      expectNoWrites();
    });
  });
});
