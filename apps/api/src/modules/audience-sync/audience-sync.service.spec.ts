import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceSyncService } from './audience-sync.service';
import * as factory from './audience-provider.factory';

const COOP = {
  id: 'c1', emailAudienceProvider: 'brevo', brevoApiKey: 'enc',
  brevoMembersListId: '3', brevoResignedListId: null,
};

function makeShareholder(over: Record<string, unknown> = {}) {
  return {
    id: 'sh1', coopId: 'c1', status: 'ACTIVE',
    firstName: 'Ann', lastName: 'De Vries', companyName: null,
    email: 'ann@x.be', user: null, ...over,
  };
}

describe('AudienceSyncService', () => {
  let service: AudienceSyncService;
  let prisma: any;
  let upsert: jest.Mock;

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue('updated');
    jest.spyOn(factory, 'getAudienceProvider').mockReturnValue({
      verifyConnection: jest.fn(), listLists: jest.fn(), upsertContact: upsert,
    } as any);

    prisma = {
      coop: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      shareholder: { findUnique: jest.fn(), findMany: jest.fn() },
      brevoSyncRun: { create: jest.fn().mockResolvedValue({}) },
    };

    const mod = await Test.createTestingModule({
      providers: [AudienceSyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AudienceSyncService);
  });

  it('reconcileOne upserts an ACTIVE member into the members list', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.updated).toBe(1);
    const input = upsert.mock.calls[0][0];
    expect(input).toMatchObject({
      extId: 'sh1', email: 'ann@x.be',
      attributes: { FIRSTNAME: 'Ann', LASTNAME: 'De Vries' },
      addListIds: [3], removeListIds: [], createIfMissing: true,
    });
  });

  it('reconcileOne moves an INACTIVE member off the members list, no create', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    upsert.mockResolvedValue('noop');
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.moved).toBe(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [], removeListIds: [3], createIfMissing: false,
    });
  });

  it('reconcileOne skips when no email can be resolved', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder({ email: null, user: null }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reconcileOne is a no-op when the coop has no provider', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, emailAudienceProvider: null });
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reconcileOne prefers User.email over Shareholder.email', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(
      makeShareholder({ email: 'old@x.be', user: { email: 'new@x.be' } }),
    );
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0].email).toBe('new@x.be');
  });

  it('reconcileAll tallies a failure without aborting and writes a PARTIAL run', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findMany.mockResolvedValue([
      makeShareholder({ id: 'a' }),
      makeShareholder({ id: 'b' }),
    ]);
    upsert.mockResolvedValueOnce('updated').mockRejectedValueOnce(new Error('boom'));
    const s = await service.reconcileAll('c1', 'cron');
    expect(s.updated).toBe(1);
    expect(s.failed).toBe(1);
    expect(prisma.brevoSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL', trigger: 'cron' }) }),
    );
  });
});
