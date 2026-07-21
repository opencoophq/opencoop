jest.mock('../../common/crypto/field-encryption', () => ({
  encryptField: jest.fn((v: string) => `encrypted:${v}`),
  decryptField: jest.fn((v: string) => v.replace('encrypted:', '')),
  isEncrypted: jest.fn((v: string) => v.startsWith('encrypted:')),
}));

process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64);

import { ConflictException } from '@nestjs/common';
import { ShareholdersService } from './shareholders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// Minimal stub shareholder returned by findById/findFirst
function makeShareholder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sh-1',
    coopId: 'coop-1',
    email: null,
    userId: null,
    type: 'INDIVIDUAL',
    status: 'ACTIVE',
    firstName: 'Jan',
    lastName: 'Peeters',
    nationalId: null,
    birthDate: null,
    companyName: null,
    companyId: null,
    vatNumber: null,
    legalForm: null,
    phone: null,
    bankIban: null,
    bankBic: null,
    address: null,
    referralCode: null,
    registeredByUserId: null,
    isEcoPowerClient: false,
    ecoPowerId: null,
    registrations: [],
    beneficialOwners: [],
    documents: [],
    dividendPayouts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ShareholdersService', () => {
  let service: ShareholdersService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let audienceQueue: { add: jest.Mock };

  const validCreateDto = {
    type: 'INDIVIDUAL' as const,
    firstName: 'Jan',
    lastName: 'Peeters',
    email: 'jan@example.be',
  };

  beforeEach(() => {
    prismaService = {
      shareholder: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      coop: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    auditService = {
      log: jest.fn(),
      diff: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<AuditService>;

    audienceQueue = { add: jest.fn().mockResolvedValue(undefined) };

    service = new ShareholdersService(prismaService, auditService, audienceQueue as never);
  });

  describe('findAll — lean list payload', () => {
    it('returns lean rows with server-precomputed sharesOwned (sum of quantity over ACTIVE/COMPLETED BUY regs) and memberSince (earliest registerDate), and drops nested data', async () => {
      const row = {
        id: 'sh-1',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        firstName: 'Jan',
        lastName: 'Peeters',
        companyName: null,
        email: 'jan@x.com',
        isEcoPowerClient: false,
        channelId: null,
        createdAt: new Date('2024-06-01T00:00:00Z'),
        registrations: [
          { quantity: 5, status: 'ACTIVE', registerDate: new Date('2023-02-01T00:00:00Z') },
          { quantity: 3, status: 'COMPLETED', registerDate: new Date('2022-01-15T00:00:00Z') },
          // PENDING_PAYMENT contributes to memberSince but NOT to sharesOwned,
          // matching the previous client-side derivation exactly.
          { quantity: 100, status: 'PENDING_PAYMENT', registerDate: new Date('2024-03-01T00:00:00Z') },
        ],
      };

      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);
      (prismaService.shareholder.count as jest.Mock).mockResolvedValueOnce(1);

      const result = await service.findAll('coop-1', { pageSize: 10000 });

      expect(result.total).toBe(1);
      const item = result.items[0] as Record<string, unknown>;

      // Parity: sum of quantity over ACTIVE + COMPLETED only (5 + 3), PENDING_PAYMENT excluded.
      expect(item.sharesOwned).toBe(8);
      // memberSince = earliest registerDate across ALL fetched regs (incl PENDING_PAYMENT).
      expect(item.memberSince).toEqual(new Date('2022-01-15T00:00:00Z'));
      expect(item.firstRegistrationDate).toEqual(new Date('2022-01-15T00:00:00Z'));

      // Lean: nested arrays are not leaked into the response.
      expect(item.registrations).toBeUndefined();
      expect(item.beneficialOwners).toBeUndefined();
      expect(item.nationalId).toBeUndefined();
    });

    it('falls back to createdAt for memberSince when there are no registrations', async () => {
      const createdAt = new Date('2024-06-01T00:00:00Z');
      const row = {
        id: 'sh-2',
        type: 'INDIVIDUAL',
        status: 'PENDING',
        firstName: 'Els',
        lastName: 'Devos',
        companyName: null,
        email: 'els@x.com',
        isEcoPowerClient: false,
        channelId: null,
        createdAt,
        registrations: [],
      };

      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);
      (prismaService.shareholder.count as jest.Mock).mockResolvedValueOnce(1);

      const result = await service.findAll('coop-1', {});
      const item = result.items[0] as Record<string, unknown>;

      expect(item.sharesOwned).toBe(0);
      expect(item.memberSince).toEqual(createdAt);
      expect(item.firstRegistrationDate).toBeNull();
    });
  });

  describe('update — household email dedup', () => {
    it('update rejects setting email to a value already taken in the coop, even within the same household', async () => {
      // Fixture: user1 owns s1 (email='shared@x.com', userId='user-1') and
      //          s2 (email=null, userId='user-1')
      // Linked household secondaries must have email=NULL — setting a non-null colliding
      // value would violate the @@unique([coopId, email]) DB constraint.
      const sharedUserId = 'user-1';
      const s2 = makeShareholder({ id: 'sh-2', email: null, userId: sharedUserId });

      (prismaService.shareholder.findFirst as jest.Mock)
        // First call: findById to load existing shareholder
        .mockResolvedValueOnce(s2)
        // Second call: email collision check — finds s1 (same userId)
        .mockResolvedValueOnce({ userId: sharedUserId });

      await expect(
        service.update('sh-2', 'coop-1', { email: 'shared@x.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('update still rejects email collision when shareholders belong to different Users', async () => {
      // Fixture: u1 owns s1 (email='taken@x.com', userId='user-1')
      //          u2 owns s2 (email=null, userId='user-2')
      const s2 = makeShareholder({ id: 'sh-2', email: null, userId: 'user-2' });

      (prismaService.shareholder.findFirst as jest.Mock)
        // First call: findById to load existing shareholder (s2)
        .mockResolvedValueOnce(s2)
        // Second call: email collision check — finds s1 with different userId
        .mockResolvedValueOnce({ userId: 'user-1' });

      await expect(
        service.update('sh-2', 'coop-1', { email: 'taken@x.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('audience-sync emit points', () => {
    it('enqueues reconcile-one after creating a shareholder', async () => {
      (prismaService.shareholder.findFirst as jest.Mock)
        // email uniqueness check
        .mockResolvedValueOnce(null)
        // referral-code uniqueness check
        .mockResolvedValueOnce(null);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValueOnce(
        makeShareholder({ id: 'sh9', coopId: 'c1', email: 'jan@example.be' }),
      );
      (auditService.log as jest.Mock).mockResolvedValueOnce(undefined);

      await service.create('c1', validCreateDto);
      expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', {
        coopId: 'c1',
        shareholderId: 'sh9',
      });
    });

    it('enqueues reconcile-one when email/status/name changes on update', async () => {
      const existing = makeShareholder({ id: 'sh1', coopId: 'c1', email: 'old@x.be' });
      (prismaService.shareholder.findFirst as jest.Mock)
        // findById (load existing)
        .mockResolvedValueOnce(existing)
        // email collision check — free
        .mockResolvedValueOnce(null)
        // findById (return after update)
        .mockResolvedValueOnce({ ...existing, email: 'new@x.be' });
      (prismaService.shareholder.update as jest.Mock).mockResolvedValueOnce({
        ...existing,
        email: 'new@x.be',
      });
      (auditService.diff as jest.Mock).mockReturnValueOnce([
        { field: 'email', oldValue: 'old@x.be', newValue: 'new@x.be' },
      ]);
      (auditService.log as jest.Mock).mockResolvedValueOnce(undefined);

      await service.update('sh1', 'c1', { email: 'new@x.be' } as any);
      expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', {
        coopId: 'c1',
        shareholderId: 'sh1',
      });
    });

    it('enqueues reconcile-one when only companyName changes on update', async () => {
      const existing = makeShareholder({
        id: 'sh1',
        coopId: 'c1',
        type: 'COMPANY',
        companyName: 'OldCo NV',
        firstName: null,
        lastName: null,
      });
      (prismaService.shareholder.findFirst as jest.Mock)
        // findById (load existing)
        .mockResolvedValueOnce(existing)
        // findById (return after update)
        .mockResolvedValueOnce({ ...existing, companyName: 'NewCo BV' });
      (prismaService.shareholder.update as jest.Mock).mockResolvedValueOnce({
        ...existing,
        companyName: 'NewCo BV',
      });
      (auditService.diff as jest.Mock).mockReturnValueOnce([
        { field: 'companyName', oldValue: 'OldCo NV', newValue: 'NewCo BV' },
      ]);
      (auditService.log as jest.Mock).mockResolvedValueOnce(undefined);

      await service.update('sh1', 'c1', { companyName: 'NewCo BV' } as any);
      expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', {
        coopId: 'c1',
        shareholderId: 'sh1',
      });
    });

    it('does NOT enqueue when an update changes only non-synced fields', async () => {
      const existing = makeShareholder({ id: 'sh1', coopId: 'c1' });
      (prismaService.shareholder.findFirst as jest.Mock)
        // findById (load existing)
        .mockResolvedValueOnce(existing)
        // findById (return after update)
        .mockResolvedValueOnce({ ...existing, phone: '0499' });
      (prismaService.shareholder.update as jest.Mock).mockResolvedValueOnce({
        ...existing,
        phone: '0499',
      });
      (auditService.diff as jest.Mock).mockReturnValueOnce([
        { field: 'phone', oldValue: null, newValue: '0499' },
      ]);
      (auditService.log as jest.Mock).mockResolvedValueOnce(undefined);

      await service.update('sh1', 'c1', { phone: '0499' } as any);
      expect(audienceQueue.add).not.toHaveBeenCalled();
    });

    it('still commits the mutation when the queue throws (best-effort)', async () => {
      audienceQueue.add.mockRejectedValueOnce(new Error('redis down'));
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      (prismaService.shareholder.create as jest.Mock).mockResolvedValueOnce(
        makeShareholder({ id: 'sh9', coopId: 'c1', email: 'jan@example.be' }),
      );
      (auditService.log as jest.Mock).mockResolvedValueOnce(undefined);

      await expect(service.create('c1', validCreateDto)).resolves.toBeDefined();
    });
  });
});
