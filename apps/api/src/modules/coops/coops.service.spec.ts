// documents.service transitively imports @react-pdf/renderer (ESM-only) — mock it
// before any import that could trigger the chain.
jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));

jest.mock('../../common/crypto/field-encryption', () => ({
  encryptField: jest.fn((v: string) => `encrypted:${v}`),
}));

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { Test } from '@nestjs/testing';
import { CoopsService } from './coops.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShareholdersService } from '../shareholders/shareholders.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

describe('CoopsService.publicRegister — orphan-shareholder preflight', () => {
  let service: CoopsService;
  let prisma: any;
  let shareholdersService: any;
  let registrationsService: any;

  const baseCoop = {
    id: 'coop-1',
    slug: 'bronsgroen',
    shareClasses: [{ id: 'sc-1', isActive: true }],
    projects: [],
  };

  beforeEach(async () => {
    prisma = {
      coop: { findUnique: jest.fn().mockResolvedValue(baseCoop) },
      shareholder: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    shareholdersService = { create: jest.fn() };
    registrationsService = {
      createBuy: jest.fn().mockResolvedValue({ id: 'reg-1', ogmCode: '+++000/0001/00097+++' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoopsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShareholdersService, useValue: shareholdersService },
        { provide: RegistrationsService, useValue: registrationsService },
        { provide: AuditService, useValue: {} },
        { provide: EmailService, useValue: { sendReferralSuccessNotification: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CoopsService);
  });

  const dto = {
    type: 'INDIVIDUAL' as const,
    firstName: 'Els',
    lastName: 'Rinkes',
    email: 'Els.Rinkes@telenet.be',
    shareClassId: 'sc-1',
    quantity: 1,
    privacyAccepted: true,
  };

  it('returns existing_shareholder (orphan) when email matches a migrated shareholder with no user account', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({ userId: null });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(result).toEqual({
      status: 'existing_shareholder',
      email: 'els.rinkes@telenet.be',
      hasUserAccount: false,
    });
    expect(prisma.shareholder.findFirst).toHaveBeenCalledWith({
      where: { coopId: 'coop-1', email: 'els.rinkes@telenet.be' },
      select: { userId: true },
    });
    expect(shareholdersService.create).not.toHaveBeenCalled();
    expect(registrationsService.createBuy).not.toHaveBeenCalled();
  });

  it('returns existing_shareholder with hasUserAccount=true when email matches a linked shareholder', async () => {
    prisma.shareholder.findFirst.mockResolvedValue({ userId: 'user-9' });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(result).toEqual({
      status: 'existing_shareholder',
      email: 'els.rinkes@telenet.be',
      hasUserAccount: true,
    });
    expect(shareholdersService.create).not.toHaveBeenCalled();
  });

  it('proceeds with normal registration when email is new', async () => {
    prisma.shareholder.findFirst.mockResolvedValue(null);
    shareholdersService.create.mockResolvedValue({ id: 'sh-new' });

    const result = await service.publicRegister('bronsgroen', dto as any);

    expect(shareholdersService.create).toHaveBeenCalledTimes(1);
    expect(registrationsService.createBuy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'registered',
      registrationId: 'reg-1',
      shareholderId: 'sh-new',
    });
  });

  it('skips preflight entirely when dto.isGift=true (recipient-email collision must not block anonymous gift buyers)', async () => {
    shareholdersService.create.mockResolvedValue({ id: 'sh-new' });

    await service.publicRegister('bronsgroen', { ...dto, isGift: true } as any);

    expect(prisma.shareholder.findFirst).not.toHaveBeenCalled();
    expect(shareholdersService.create).toHaveBeenCalledTimes(1);
  });
});

describe('CoopsService — Brevo audience-sync config', () => {
  let service: CoopsService;
  let prisma: {
    coop: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
  };
  beforeEach(async () => {
    prisma = {
      coop: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoopsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShareholdersService, useValue: {} },
        { provide: RegistrationsService, useValue: {} },
        {
          provide: AuditService,
          useValue: {
            diff: jest.fn().mockReturnValue([]),
            log: jest.fn(),
          },
        },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(CoopsService);
  });

  it('encrypts brevoApiKey before persisting and preserves it when blank', async () => {
    prisma.coop.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.coop.update.mockResolvedValue({ id: 'c1', brevoApiKey: 'encrypted:xkeysib-secret' });

    await service.update('c1', { brevoApiKey: 'xkeysib-secret' } as any);

    expect(prisma.coop.update.mock.calls[0][0].data.brevoApiKey).toBeDefined();
    expect(prisma.coop.update.mock.calls[0][0].data.brevoApiKey).not.toBe('xkeysib-secret');
    expect(prisma.coop.update.mock.calls[0][0].data.brevoApiKey).toBe('encrypted:xkeysib-secret');

    prisma.coop.update.mockClear();
    prisma.coop.update.mockResolvedValue({ id: 'c1' });

    await service.update('c1', { brevoApiKey: '' } as any);

    expect(prisma.coop.update.mock.calls[0][0].data).not.toHaveProperty('brevoApiKey');
  });

  it('getSettings never returns brevoApiKey', async () => {
    prisma.coop.findUnique.mockResolvedValue({ id: 'c1', brevoMembersListId: '3' });

    const r = await service.getSettings('c1');

    expect(r).not.toHaveProperty('brevoApiKey');
    const select = prisma.coop.findUnique.mock.calls[0][0].select;
    expect(select.brevoApiKey).toBeFalsy();
    expect(select.brevoMembersListId).toBe(true);
    expect(select.brevoResignedListId).toBe(true);
    expect(select.emailAudienceProvider).toBe(true);
    expect(select.brevoLastSyncAt).toBe(true);
    expect(select.brevoLastSyncStatus).toBe(true);
  });

  it('update() never returns brevoApiKey even if Prisma returns it', async () => {
    prisma.coop.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.coop.update.mockResolvedValue({
      id: 'c1',
      brevoApiKey: 'encrypted:some-ciphertext',
      name: 'Test Coop',
    });

    const r = await service.update('c1', { name: 'Test Coop' } as any);

    expect(r).not.toHaveProperty('brevoApiKey');
    expect(r).toMatchObject({ name: 'Test Coop' });
  });

  it('masks brevoApiKey changes in audit log', async () => {
    // Real AuditService — no existing audit.service.spec.ts; exercise masking directly.
    const realAudit = new AuditService(prisma as unknown as PrismaService);
    await realAudit.log({
      coopId: 'c1',
      entity: 'Coop',
      entityId: 'c1',
      action: 'UPDATE',
      changes: [
        { field: 'brevoApiKey', oldValue: 'old-key', newValue: 'new-key' },
        { field: 'name', oldValue: 'A', newValue: 'B' },
      ],
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const stored = prisma.auditLog.create.mock.calls[0][0].data.changes as Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }>;
    const brevoChange = stored.find((c) => c.field === 'brevoApiKey');
    expect(brevoChange).toEqual({ field: 'brevoApiKey', oldValue: '***', newValue: '***' });
    const nameChange = stored.find((c) => c.field === 'name');
    expect(nameChange).toEqual({ field: 'name', oldValue: 'A', newValue: 'B' });
  });
});
