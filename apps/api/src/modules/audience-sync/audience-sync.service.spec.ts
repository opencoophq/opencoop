import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceSyncService } from './audience-sync.service';
import { AudienceProviderError } from './audience-sync.errors';
import * as factory from './audience-provider.factory';

const COOP = {
  id: 'c1',
  emailAudienceProvider: 'brevo',
  brevoApiKey: 'enc',
  brevoMembersListId: '3',
  brevoResignedListId: null,
};

function makeShareholder(over: Record<string, unknown> = {}) {
  return {
    id: 'sh1',
    coopId: 'c1',
    status: 'ACTIVE',
    firstName: 'Ann',
    lastName: 'De Vries',
    companyName: null,
    email: 'ann@x.be',
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    userId: null,
    user: null,
    ...over,
  };
}

describe('AudienceSyncService', () => {
  let service: AudienceSyncService;
  let prisma: any;
  let upsert: jest.Mock;

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue('updated');
    jest.spyOn(factory, 'getAudienceProvider').mockReturnValue({
      verifyConnection: jest.fn(),
      listLists: jest.fn(),
      upsertContact: upsert,
    } as any);

    prisma = {
      coop: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      shareholder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      brevoSyncRun: {
        create: jest.fn().mockResolvedValue({ id: 'run1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const mod = await Test.createTestingModule({
      providers: [AudienceSyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AudienceSyncService);
  });

  it('reconcileOne upserts an ACTIVE member into the members list', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.updated).toBe(1);
    expect(s.created).toBe(0);
    const input = upsert.mock.calls[0][0];
    expect(input).toMatchObject({
      extId: 'sh1',
      email: 'ann@x.be',
      attributes: { FIRSTNAME: 'Ann', LASTNAME: 'De Vries', COOPERANT: true, STATUS: 'active' },
      addListIds: [3],
      removeListIds: [],
      createIfMissing: true,
    });
  });

  it('reconcileOne removes an ACTIVE member from the prospects list', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      ...COOP,
      brevoResignedListId: '9',
      brevoProspectsListId: '15',
    });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'ACTIVE' }));
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [3],
      removeListIds: [9, 15],
      attributes: { COOPERANT: true, STATUS: 'active' },
    });
  });

  it('reconcileOne marks an INACTIVE shareholder as resigned and does not touch prospects', async () => {
    prisma.coop.findUnique.mockResolvedValue({
      ...COOP,
      brevoResignedListId: '9',
      brevoProspectsListId: '15',
    });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [9],
      removeListIds: [3],
      attributes: { COOPERANT: false, STATUS: 'resigned' },
    });
    expect(upsert.mock.calls[0][0].removeListIds).not.toContain(15);
  });

  it('reconcileOne does not label a PENDING shareholder as resigned', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'PENDING' }));
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0].attributes).toMatchObject({ COOPERANT: false });
    expect(upsert.mock.calls[0][0].attributes).not.toHaveProperty('STATUS');
  });

  it('reconcileAll records UNKNOWN_ATTRIBUTE and keeps going', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findMany.mockResolvedValue([
      makeShareholder({ id: 'a', email: 'a@x.be' }),
      makeShareholder({ id: 'b', email: 'b@x.be' }),
    ]);
    upsert
      .mockRejectedValueOnce(new AudienceProviderError('UNKNOWN_ATTRIBUTE'))
      .mockResolvedValueOnce('updated');
    const s = await service.reconcileAll('c1', 'cron');
    expect(s.failed).toBe(1);
    expect(s.updated).toBe(1);
    expect(s.errors[0]).toMatchObject({ shareholderId: 'a', code: 'UNKNOWN_ATTRIBUTE' });
    expect(prisma.brevoSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PARTIAL' }),
      }),
    );
  });

  it('reconcileOne counts a created contact separately from an update', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder());
    upsert.mockResolvedValue('created');
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.created).toBe(1);
    expect(s.updated).toBe(0);
  });

  it('counts a successful resigned-list PUT as moved (lists re-applied, not a verified diff)', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, brevoResignedListId: '9' });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.moved).toBe(1);
    expect(s.unlinked).toBe(0);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [9],
      removeListIds: [3],
      createIfMissing: false,
    });
  });

  it('reconcileOne counts a missing INACTIVE contact as noop, not moved', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, brevoResignedListId: '9' });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    upsert.mockResolvedValue('noop');
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.noop).toBe(1);
    expect(s.moved).toBe(0);
    expect(s.skipped).toBe(0);
  });

  it('reconcileOne unlinks an INACTIVE member when no resigned list is configured', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.unlinked).toBe(1);
    expect(s.moved).toBe(0);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [],
      removeListIds: [3],
      createIfMissing: false,
    });
  });

  it('reconcileOne unlinks a PENDING member from the members list', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ status: 'PENDING' }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.unlinked).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        addListIds: [],
        removeListIds: [3],
        createIfMissing: false,
      }),
    );
  });

  it('reconcileOne unlinks a PENDING shareholder without an email when the contact exists', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(
      makeShareholder({ status: 'PENDING', email: null, user: null }),
    );
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.unlinked).toBe(1);
    expect(s.moved).toBe(0);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: null,
        removeListIds: [3],
        createIfMissing: false,
      }),
    );
  });

  it('reconcileOne counts a missing contact with no email as skipped', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ email: null, user: null }));
    upsert.mockResolvedValue('noop');
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(s.updated).toBe(0);
    expect(s.noop).toBe(0);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        extId: 'sh1',
        email: null,
        addListIds: [],
        removeListIds: [3],
        createIfMissing: false,
      }),
    );
  });

  it('reconcileOne unlinks an ACTIVE shareholder with no email from the members list', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, brevoResignedListId: '9' });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder({ email: null, user: null }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.unlinked).toBe(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      email: null,
      addListIds: [],
      removeListIds: [3],
      createIfMissing: false,
    });
  });

  it('reconcileOne skips shareholders outside the requested coop', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(null);
    const s = await service.reconcileOne('c1', 'sh1');
    expect(upsert).not.toHaveBeenCalled();
    expect(s.skipped).toBe(1);
    expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
      where: { id: 'sh1', coopId: 'c1' },
      select: expect.anything(),
    });
  });

  it('reconcileOne is a no-op when the coop has no provider', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, emailAudienceProvider: null });
    prisma.shareholder.findFirst.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reconcileOne prefers User.email over Shareholder.email and normalizes it', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findFirst.mockResolvedValue(
      makeShareholder({ email: 'old@x.be', user: { email: '  New@X.be ' } }),
    );
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0].email).toBe('new@x.be');
  });

  it('reconcileOne keeps one contact per shared email and unlinks the secondary EXT_ID', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, brevoResignedListId: '9' });
    const parent = makeShareholder({
      id: 'parent',
      createdAt: new Date('2019-01-01'),
      email: 'parent@x.be',
      userId: 'user-parent',
      user: { email: 'parent@x.be' },
    });
    const child = makeShareholder({
      id: 'child',
      createdAt: new Date('2021-01-01'),
      email: null,
      userId: 'user-parent',
      user: { email: 'Parent@X.be' },
      firstName: 'Bo',
    });
    prisma.shareholder.findFirst.mockResolvedValue(child);
    prisma.$queryRaw.mockResolvedValue([{ id: 'child' }, { id: 'parent' }]);
    prisma.shareholder.findMany.mockResolvedValue([child, parent]);

    const s = await service.reconcileOne('c1', 'child');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      extId: 'parent',
      email: 'parent@x.be',
      attributes: {
        FIRSTNAME: 'Ann',
        LASTNAME: 'De Vries',
        COOPERANT: true,
        STATUS: 'active',
      },
      addListIds: [3],
      removeListIds: [9],
      createIfMissing: true,
      claimFromExtIds: ['child'],
    });
    expect(upsert.mock.calls[1][0]).toMatchObject({
      extId: 'child',
      email: null,
      addListIds: [],
      removeListIds: [3, 9],
      createIfMissing: false,
    });
    expect(upsert.mock.calls[1][0]).not.toHaveProperty('forceMerge');
    expect(s.updated).toBe(1);
    expect(s.unlinked).toBe(1);
    expect(s.failed).toBe(0);
    const sql = prisma.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain('lower(trim(');
    expect(prisma.$queryRaw.mock.calls[0]).toContain('parent@x.be');
  });

  it('keeps the shared contact on the members list when the active member is not the oldest', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    const inactive = makeShareholder({
      id: 'inactive',
      status: 'INACTIVE',
      createdAt: new Date('2015-01-01'),
      email: null,
      userId: 'user-1',
      user: { email: 'shared@x.be' },
    });
    const active = makeShareholder({
      id: 'active',
      status: 'ACTIVE',
      createdAt: new Date('2024-06-01'),
      email: null,
      userId: 'user-1',
      user: { email: 'shared@x.be' },
      firstName: 'Bo',
    });
    prisma.shareholder.findFirst.mockResolvedValue(inactive);
    prisma.$queryRaw.mockResolvedValue([{ id: 'inactive' }, { id: 'active' }]);
    prisma.shareholder.findMany.mockResolvedValue([inactive, active]);

    const s = await service.reconcileOne('c1', 'inactive');

    expect(upsert.mock.calls[0][0]).toMatchObject({
      extId: 'active',
      email: 'shared@x.be',
      addListIds: [3],
      removeListIds: [],
      createIfMissing: true,
      claimFromExtIds: ['inactive'],
    });
    const unlinked = upsert.mock.calls.filter(
      (call) => (call[0] as { addListIds: number[] }).addListIds.length === 0,
    );
    expect(unlinked.map((call) => (call[0] as { extId: string }).extId)).toEqual(['inactive']);
    expect(s.updated).toBe(1);
    expect(s.unlinked).toBe(1);
    expect(s.failed).toBe(0);
  });

  it('reconcileAll tallies a failure without aborting and writes a PARTIAL run', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findMany.mockResolvedValue([
      makeShareholder({ id: 'a', email: 'a@x.be' }),
      makeShareholder({ id: 'b', email: 'b@x.be' }),
    ]);
    upsert
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new AudienceProviderError('DUPLICATE_EMAIL'));
    const s = await service.reconcileAll('c1', 'cron');
    expect(s.updated).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errors).toEqual([
      {
        shareholderId: 'b',
        email: 'b***@x***.be',
        code: 'DUPLICATE_EMAIL',
        message: 'DUPLICATE_EMAIL',
      },
    ]);
    expect(JSON.stringify(s.errors)).not.toContain('b@x.be');
    expect(prisma.brevoSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RUNNING', trigger: 'cron' }),
      }),
    );
    expect(prisma.brevoSyncRun.create.mock.calls[0][0].data).not.toHaveProperty('finishedAt');
    expect(prisma.brevoSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run1' },
        data: expect.objectContaining({
          status: 'PARTIAL',
          finishedAt: expect.any(Date),
          created: 0,
          added: 0,
          updated: 1,
          failed: 1,
          unlinked: 0,
          noop: 0,
        }),
      }),
    );
  });

  it('reconcileAll separates created, moved, unlinked, noop and skipped counters', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, brevoResignedListId: '9' });
    prisma.shareholder.findMany.mockResolvedValue([
      makeShareholder({ id: 'active', email: 'active@x.be' }),
      makeShareholder({ id: 'resigned', email: 'resigned@x.be', status: 'INACTIVE' }),
      makeShareholder({ id: 'pending', email: 'pending@x.be', status: 'PENDING' }),
      makeShareholder({ id: 'missing', email: 'missing@x.be', status: 'INACTIVE' }),
      makeShareholder({ id: 'noemail', email: null, user: null, status: 'ACTIVE' }),
    ]);
    upsert.mockImplementation(async (input: { extId: string }) => {
      if (input.extId === 'active') return 'created';
      if (input.extId === 'missing' || input.extId === 'noemail') return 'noop';
      return 'updated';
    });

    const s = await service.reconcileAll('c1', 'manual');

    expect(s).toMatchObject({
      created: 1,
      updated: 0,
      moved: 1,
      unlinked: 1,
      noop: 1,
      skipped: 1,
      failed: 0,
    });
    const persisted = prisma.brevoSyncRun.update.mock.calls[0][0].data;
    expect(persisted).toMatchObject({
      status: 'OK',
      added: 1,
      created: 1,
      moved: 1,
      unlinked: 1,
      noop: 1,
      skipped: 1,
      failed: 0,
    });
  });

  it('reconcileAll opens the run as RUNNING and closes only a stale previous run', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findMany.mockResolvedValue([]);
    await service.reconcileAll('c1', 'cron');
    expect(prisma.brevoSyncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          coopId: 'c1',
          status: 'RUNNING',
          startedAt: { lt: expect.any(Date) },
        },
        data: expect.objectContaining({
          status: 'ERROR',
          errors: [expect.objectContaining({ code: 'RUN_INTERRUPTED' })],
        }),
      }),
    );
    const cutoff = prisma.brevoSyncRun.updateMany.mock.calls[0][0].where.startedAt.lt as Date;
    const ageMs = Date.now() - cutoff.getTime();
    expect(ageMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 5_000);
    expect(ageMs).toBeLessThan(2 * 60 * 60 * 1000 + 5_000);
    const lockSql = prisma.$executeRaw.mock.calls[0][0].join('');
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('audience-sync:c1');
    expect(prisma.brevoSyncRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          coopId: 'c1',
          status: 'RUNNING',
          startedAt: { gte: expect.any(Date) },
        },
      }),
    );
    const updateManyOrder = prisma.brevoSyncRun.updateMany.mock.invocationCallOrder[0];
    const createOrder = prisma.brevoSyncRun.create.mock.invocationCallOrder[0];
    const updateOrder = prisma.brevoSyncRun.update.mock.invocationCallOrder[0];
    expect(updateManyOrder).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(updateOrder);
  });

  it('reconcileAll skips when a run from the last two hours is still RUNNING', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.brevoSyncRun.findFirst.mockResolvedValue({ id: 'busy' });
    const s = await service.reconcileAll('c1', 'manual');
    expect(s).toMatchObject({ created: 0, updated: 0, failed: 0, errors: [] });
    expect(prisma.brevoSyncRun.create).not.toHaveBeenCalled();
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
    expect(prisma.coop.update).not.toHaveBeenCalled();
  });

  it('reconcileAll records ERROR on the open run and rethrows when provider creation fails', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    jest.spyOn(factory, 'getAudienceProvider').mockImplementation(() => {
      throw new Error('factory boom for hidden@x.be');
    });
    await expect(service.reconcileAll('c1', 'cron')).rejects.toThrow('factory boom');
    expect(prisma.coop.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ brevoLastSyncStatus: 'ERROR' }),
      }),
    );
    expect(prisma.brevoSyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run1' },
        data: expect.objectContaining({
          status: 'ERROR',
          errors: [
            expect.objectContaining({
              code: 'SYNC_FAILED',
              message: 'factory boom for h***@x***.be',
            }),
          ],
        }),
      }),
    );
    expect(JSON.stringify(prisma.brevoSyncRun.update.mock.calls[0][0])).not.toContain(
      'hidden@x.be',
    );
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
  });
});
