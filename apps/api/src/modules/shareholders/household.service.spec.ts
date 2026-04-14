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

  describe('linkShareholderToUser', () => {
    it('sets shareholder.userId to target user and clears shareholder.email', async () => {
      const updatedShareholder = { ...wife, userId: jan.id, email: null };

      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(wife)       // coop-ownership check
        .mockResolvedValueOnce(janShareholder); // target-in-coop check
      (prismaService.shareholder.update as jest.Mock).mockResolvedValue(updatedShareholder);

      const linked = await service.linkShareholderToUser({
        coopId: coop1.id,
        shareholderId: wife.id,
        targetUserId: jan.id,
        actorUserId: adminUser.id,
      });

      expect(linked.userId).toBe(jan.id);
      expect(linked.email).toBeNull();

      expect(prismaService.shareholder.update).toHaveBeenCalledWith({
        where: { id: wife.id },
        data: { userId: jan.id, email: null },
      });
    });

    it('throws NotFoundException when shareholder belongs to a different coop than the route coopId', async () => {
      // findFirst returns null because shareholderId doesn't belong to coopId in route
      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.linkShareholderToUser({
          coopId: coop1.id,
          shareholderId: 'coop-b-shareholder-id',
          targetUserId: jan.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when target user is not a shareholder in the same coop', async () => {
      // Wife is in coop1; Jan has no shareholder record in coop1
      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(wife)  // coop-ownership check passes
        .mockResolvedValueOnce(null); // target-in-coop check fails

      await expect(
        service.linkShareholderToUser({
          coopId: coop1.id,
          shareholderId: wife.id,
          targetUserId: jan.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(/not associated with this cooperative/i);
    });

    it('returns existing shareholder unchanged when already linked to target user (idempotent)', async () => {
      const alreadyLinked = { ...wife, userId: jan.id };

      (prismaService.shareholder.findFirst as jest.Mock).mockResolvedValueOnce(alreadyLinked);

      const result = await service.linkShareholderToUser({
        coopId: coop1.id,
        shareholderId: wife.id,
        targetUserId: jan.id,
        actorUserId: adminUser.id,
      });

      expect(result).toBe(alreadyLinked);
      expect(prismaService.shareholder.update).not.toHaveBeenCalled();
    });

    it('throws when shareholder is already linked to a different user', async () => {
      const linkedToDifferentUser = { ...wife, userId: 'other-user-id' };

      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(linkedToDifferentUser) // first call
        .mockResolvedValueOnce(linkedToDifferentUser); // second call

      await expect(
        service.linkShareholderToUser({
          coopId: coop1.id,
          shareholderId: wife.id,
          targetUserId: jan.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.linkShareholderToUser({
          coopId: coop1.id,
          shareholderId: wife.id,
          targetUserId: jan.id,
          actorUserId: adminUser.id,
        }),
      ).rejects.toThrow(/emancipate first/i);
    });

    it('records audit log entry with before/after state', async () => {
      const updatedShareholder = { ...wife, userId: jan.id, email: null };

      (prismaService.shareholder.findFirst as jest.Mock)
        .mockResolvedValueOnce(wife)         // coop-ownership check
        .mockResolvedValueOnce(janShareholder); // target-in-coop check
      (prismaService.shareholder.update as jest.Mock).mockResolvedValue(updatedShareholder);

      await service.linkShareholderToUser({
        coopId: coop1.id,
        shareholderId: wife.id,
        targetUserId: jan.id,
        actorUserId: adminUser.id,
      });

      expect(prismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            coopId: coop1.id,
            entity: 'Shareholder',
            entityId: wife.id,
            action: 'LINK_SHAREHOLDER_TO_HOUSEHOLD',
            actorId: adminUser.id,
            changes: expect.arrayContaining([
              expect.objectContaining({ field: 'userId', oldValue: null, newValue: jan.id }),
              expect.objectContaining({ field: 'email', oldValue: 'marie@x.com', newValue: null }),
            ]),
          }),
        }),
      );
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
});
