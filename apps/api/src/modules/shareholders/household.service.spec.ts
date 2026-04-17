import { HouseholdService } from './household.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmancipationService } from '../auth/emancipation.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('HouseholdService', () => {
  let service: HouseholdService;
  let prismaService: PrismaService;
  let auditService: AuditService;
  let emancipationService: EmancipationService;

  const coop1 = { id: 'coop-1' };
  const coop2 = { id: 'coop-2' };
  const adminUser = { id: 'admin-user-id' };

  // Wife: shareholder with her own email, not yet linked to a user
  const wife = {
    id: 'wife-shareholder-id',
    coopId: coop1.id,
    userId: null as string | null,
    email: 'marie@x.com',
    createdAt: new Date('2024-01-01'),
  };

  // Jan: user who is a shareholder in coop1
  const jan = {
    id: 'jan-user-id',
  };

  const janShareholder = {
    id: 'jan-shareholder-id',
    coopId: coop1.id,
    userId: jan.id,
  };

  beforeEach(() => {
    prismaService = {
      shareholder: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prismaService)),
    } as unknown as PrismaService;

    auditService = {
      log: jest.fn(),
    } as unknown as AuditService;

    emancipationService = {
      startEmancipation: jest.fn().mockResolvedValue({ id: 'emancipation-token-id' }),
    } as unknown as EmancipationService;

    service = new HouseholdService(prismaService, auditService, emancipationService);
  });

  describe('linkShareholders', () => {
    // Source: the shareholder the admin is currently viewing
    const source = {
      id: 'source-shareholder-id',
      coopId: coop1.id,
      userId: null as string | null,
      email: 'laurette@telenet.be',
    };

    // Target (user-backed): Jan with an existing User account
    const targetWithUser = {
      id: 'jan-shareholder-id',
      coopId: coop1.id,
      userId: jan.id,
      email: null as string | null,
    };

    // Target (userless): Jan as a pure imported shareholder
    const targetWithoutUser = {
      id: 'jan-shareholder-id',
      coopId: coop1.id,
      userId: null as string | null,
      email: 'jeanstevens2@telenet.be',
    };

    it('links source to target.userId when target already has a User (existing-user path)', async () => {
      const updated = { ...source, userId: jan.id, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)          // load source
        .mockResolvedValueOnce(targetWithUser); // load target
      (prismaService.shareholder.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithUser.id,
        actorUserId: adminUser.id,
      });

      expect(result.userId).toBe(jan.id);
      expect(result.email).toBeNull();
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('auto-creates a passwordless User from target.email when target has no User, then links source', async () => {
      const newUser = { id: 'new-user-id', email: targetWithoutUser.email };
      const updatedSource = { ...source, userId: newUser.id, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(null); // no pre-existing collision
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce(newUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: newUser.id, email: null }) // target update
        .mockResolvedValueOnce(updatedSource);                                              // source update

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'jeanstevens2@telenet.be',
          passwordHash: null,
          role: 'SHAREHOLDER',
        },
      });

      // Target shareholder mutated: userId set, email cleared
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: targetWithoutUser.id },
        data: { userId: newUser.id, email: null },
      });

      // Source shareholder linked to the new user
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { userId: newUser.id, email: null },
      });

      expect(result.userId).toBe(newUser.id);
    });

    it('reuses an existing User with the same email instead of creating a duplicate (defensive)', async () => {
      const existingUser = { id: 'pre-existing-user-id', email: targetWithoutUser.email };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(existingUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: existingUser.id, email: null })
        .mockResolvedValueOnce({ ...source, userId: existingUser.id, email: null });

      await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.user.create).not.toHaveBeenCalled();
      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { userId: existingUser.id, email: null },
      });
    });

    it('rejects self-link (source === target)', async () => {
      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: source.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.shareholder.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when source shareholder is not in the coop', async () => {
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: 'unknown',
          targetShareholderId: targetWithUser.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when target shareholder is not in the coop', async () => {
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(null);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: 'unknown',
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns source unchanged when already linked to target.userId (idempotent)', async () => {
      const alreadyLinked = { ...source, userId: jan.id };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(alreadyLinked)
        .mockResolvedValueOnce(targetWithUser);

      const result = await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithUser.id,
        actorUserId: adminUser.id,
      });

      expect(result).toBe(alreadyLinked);
      expect(prismaService.shareholder.update).not.toHaveBeenCalled();
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('throws when source is already linked to a different user', async () => {
      const linkedElsewhere = { ...source, userId: 'other-user-id' };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(linkedElsewhere)
        .mockResolvedValueOnce(targetWithUser);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: targetWithUser.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(/emancipate first/i);
    });

    it('rejects when target has no email (cannot auto-create anchor)', async () => {
      const targetNoEmail = { ...targetWithoutUser, email: null };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetNoEmail);

      await expect(
        service.linkShareholders({
          coopId: coop1.id,
          shareholderId: source.id,
          targetShareholderId: targetNoEmail.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('writes audit rows for source link, target link, and User creation in the auto-create path', async () => {
      const newUser = { id: 'new-user-id', email: targetWithoutUser.email };
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(targetWithoutUser);
      (prismaService.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce(newUser);
      (prismaService.shareholder.update as jest.Mock)
        .mockResolvedValueOnce({ ...targetWithoutUser, userId: newUser.id, email: null })
        .mockResolvedValueOnce({ ...source, userId: newUser.id, email: null });

      await service.linkShareholders({
        coopId: coop1.id,
        shareholderId: source.id,
        targetShareholderId: targetWithoutUser.id,
        actorUserId: adminUser.id,
      });

      const auditCalls = (prismaService.auditLog.create as jest.Mock).mock.calls.map((c) => c[0].data);
      const actions = auditCalls.map((d) => d.action);
      expect(actions).toContain('CREATE_USER_FROM_SHAREHOLDER');
      expect(actions.filter((a) => a === 'LINK_SHAREHOLDER_TO_HOUSEHOLD')).toHaveLength(2);
    });
  });

  describe('unlinkShareholder', () => {
    it('throws NotFoundException when shareholder does not belong to the coop', async () => {
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.unlinkShareholder({
          coopId: coop1.id,
          shareholderId: 'unknown-shareholder-id',
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('delegates to EmancipationService.startEmancipation with HOUSEHOLD_SPLIT reason', async () => {
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(wife);

      await service.unlinkShareholder({
        coopId: coop1.id,
        shareholderId: wife.id,
        actorUserId: adminUser.id,
      });

      expect(emancipationService.startEmancipation).toHaveBeenCalledWith({
        shareholderId: wife.id,
        reason: 'HOUSEHOLD_SPLIT',
      });
    });

    it('writes audit log for UNLINK_SHAREHOLDER_FROM_HOUSEHOLD before delegating to emancipation', async () => {
      const wifWithUser = { ...wife, userId: 'some-user-id' };
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(wifWithUser);

      await service.unlinkShareholder({
        coopId: coop1.id,
        shareholderId: wife.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coopId: coop1.id,
            entity: 'Shareholder',
            entityId: wife.id,
            action: 'UNLINK_SHAREHOLDER_FROM_HOUSEHOLD',
            actorId: adminUser.id,
            changes: expect.arrayContaining([
              expect.objectContaining({ field: 'userId', oldValue: 'some-user-id', newValue: null }),
            ]),
          }),
        }),
      );

      expect(emancipationService.startEmancipation).toHaveBeenCalledWith({
        shareholderId: wife.id,
        reason: 'HOUSEHOLD_SPLIT',
      });
    });
  });

  describe('listShareholdersForUser', () => {
    it('returns all shareholders a user controls in a given coop, ordered by createdAt', async () => {
      const shareholderA1 = { id: 'sh-a1', userId: jan.id, coopId: coop1.id, createdAt: new Date('2024-01-01') };
      const shareholderA2 = { id: 'sh-a2', userId: jan.id, coopId: coop1.id, createdAt: new Date('2024-02-01') };

      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([shareholderA1, shareholderA2]);

      const result = await service.listShareholdersForUser(jan.id, coop1.id);

      expect(result).toHaveLength(2);
      expect(prismaService.shareholder.findMany).toHaveBeenCalledWith({
        where: { userId: jan.id, coopId: coop1.id },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns empty array when user has no shareholders in that coop', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listShareholdersForUser(jan.id, 'bogus-coop-id');

      expect(result).toEqual([]);
    });
  });

  describe('searchHouseholdCandidates', () => {
    const sourceId = 'source-shareholder-id';

    it('returns [] when search is shorter than 2 characters', async () => {
      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'a');
      expect(result).toEqual([]);
      expect(prismaService.shareholder.findMany).not.toHaveBeenCalled();
    });

    it('returns a userless shareholder matched by shareholder.email', async () => {
      const jan = {
        id: 'jan-id',
        firstName: 'Jan',
        lastName: 'Stevens',
        email: 'jeanstevens2@telenet.be',
        userId: null,
        user: null,
        companyName: null,
        createdAt: new Date('2024-01-01'),
      };
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([jan]);

      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'jeanstev');

      expect(result).toEqual([
        {
          shareholderId: 'jan-id',
          email: 'jeanstevens2@telenet.be',
          fullName: 'Jan Stevens',
          shareholderCount: 1,
        },
      ]);
    });

    it('returns a user-backed shareholder matched by user.email', async () => {
      const row = {
        id: 'sh-1',
        firstName: 'Alice',
        lastName: 'Dupont',
        email: null,
        userId: 'user-1',
        user: { id: 'user-1', email: 'alice@x.com' },
        companyName: null,
        createdAt: new Date('2024-01-01'),
      };
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);

      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'alice');

      expect(result).toEqual([
        {
          shareholderId: 'sh-1',
          email: 'alice@x.com',
          fullName: 'Alice Dupont',
          shareholderCount: 1,
        },
      ]);
    });

    it('collapses multiple shareholders sharing a userId into one candidate with shareholderCount = group size', async () => {
      const anchor = {
        id: 'sh-anchor',
        firstName: 'Bob',
        lastName: 'Martin',
        email: null,
        userId: 'user-2',
        user: { id: 'user-2', email: 'bob@x.com' },
        companyName: null,
        createdAt: new Date('2024-01-01'),
      };
      const sibling = {
        id: 'sh-sibling',
        firstName: 'Clara',
        lastName: 'Martin',
        email: null,
        userId: 'user-2',
        user: { id: 'user-2', email: 'bob@x.com' },
        companyName: null,
        createdAt: new Date('2024-02-01'),
      };
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([anchor, sibling]);

      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'bob');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        shareholderId: 'sh-anchor', // earliest createdAt in the group
        email: 'bob@x.com',
        fullName: 'Bob Martin',
        shareholderCount: 2,
      });
    });

    it('excludes the source shareholder from the query', async () => {
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.searchHouseholdCandidates(coop1.id, sourceId, 'anything');

      const call = (prismaService.shareholder.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.id).toEqual({ not: sourceId });
      expect(call.where.coopId).toBe(coop1.id);
    });

    it('uses companyName as fullName for COMPANY-type shareholders', async () => {
      const row = {
        id: 'sh-co',
        firstName: null,
        lastName: null,
        email: 'contact@bigco.be',
        userId: null,
        user: null,
        companyName: 'BigCo NV',
        createdAt: new Date('2024-01-01'),
      };
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce([row]);

      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'bigco');

      expect(result[0].fullName).toBe('BigCo NV');
    });

    it('sorts candidates by createdAt ascending and trims to 10 results', async () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        id: `sh-${i}`,
        firstName: 'User',
        lastName: `${i}`,
        email: `user${i}@x.com`,
        userId: null,
        user: null,
        companyName: null,
        createdAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
      }));
      (prismaService.shareholder.findMany as jest.Mock).mockResolvedValueOnce(rows);

      const result = await service.searchHouseholdCandidates(coop1.id, sourceId, 'user');

      expect(result).toHaveLength(10);
      expect(result[0].shareholderId).toBe('sh-0');
      expect(result[9].shareholderId).toBe('sh-9');
    });
  });
});
