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

    service = new ShareholdersService(prismaService, auditService);
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
});
